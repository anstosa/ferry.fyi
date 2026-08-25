import { createHmac, randomUUID } from "node:crypto";

import { Op, Transaction } from "sequelize";
import {
  SUPPORTER_ENTITLEMENT_IDENTIFIER,
  type SupporterEnvironment,
  type SupporterLifecycleState,
  type SupporterSource,
  type SupporterStatus,
  type SupporterSummary,
} from "shared/contracts/supporter";

import {
  isApplicationTokenRevoked,
  lockSubjectAuthorization,
} from "~/lib/admin/sessionRevocation";
import { db } from "~/lib/db";
import {
  createRevenueCatManagementUrl,
  listRevenueCatSubscriptions,
  REVENUECAT_PROVIDER_PROJECT_KEY,
  type RevenueCatSubscriptionSnapshot,
  type RevenueCatWebhookEnvelope,
} from "~/lib/revenueCat";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { RevenueCatWebhookEvent } from "~/models/RevenueCatWebhookEvent";
import { RevenueCatWebhookEventTarget } from "~/models/RevenueCatWebhookEventTarget";
import { SupporterAuthorityPolicy } from "~/models/SupporterAuthorityPolicy";
import { SupporterCustomer } from "~/models/SupporterCustomer";
import { SupporterEntitlement } from "~/models/SupporterEntitlement";
import { SupporterReconcileWork } from "~/models/SupporterReconcileWork";
import { SupporterSubscription } from "~/models/SupporterSubscription";

const AUTHORITY_POLICY_ID = "supporter-runtime-v1";
const SANDBOX_ALLOWLIST = "supporter-sandbox-authority";
const RECONCILE_LEASE_MS = 60_000;
const RECONCILE_RETRY_MS = 30_000;
const MANAGEMENT_ACTION = "revenuecat_management_url_v1";
const MANAGEMENT_ACCOUNT_LIMIT = 4;
const MANAGEMENT_IP_LIMIT = 20;
const MANAGEMENT_WINDOW_MS = 60_000;

interface RuntimeAuthorityScope {
  environment: SupporterEnvironment;
  providerProjectKey: string;
}

interface ProjectionState {
  active: boolean;
  activeUntil: Date | null;
  lifecycleState: SupporterLifecycleState;
  sources: SupporterSource[];
}

export class SupporterAuthorizationError extends Error {
  // fixed authentication error
  constructor() {
    super("Supporter authorization is no longer valid");
    this.name = "SupporterAuthorizationError";
  }
}

export class SupporterRateLimitError extends Error {
  retryAfterSeconds: number;

  // fixed rate limit error
  constructor(retryAfterSeconds: number) {
    super("Supporter provider action rate limit exceeded");
    this.name = "SupporterRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// parse one environment switch
const isEnabled = (name: string): boolean =>
  process.env[name]?.trim().toLowerCase() === "true";

// parse a stored authority set
const parseAuthoritySet = (
  input: unknown
): Array<{
  environment: SupporterEnvironment;
  providerProjectKey: string;
  runtimeAuthorized: boolean;
}> => {
  let value = input;
  // serialized json guard
  if (typeof value === "string") {
    // isolate malformed policy json
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  // authority collection guard
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (
      entry
    ): entry is {
      environment: SupporterEnvironment;
      providerProjectKey: string;
      runtimeAuthorized: boolean;
    } =>
      Boolean(
        entry &&
        typeof entry === "object" &&
        "environment" in entry &&
        (entry.environment === "production" ||
          entry.environment === "sandbox") &&
        "providerProjectKey" in entry &&
        typeof entry.providerProjectKey === "string" &&
        "runtimeAuthorized" in entry &&
        entry.runtimeAuthorized === true
      )
  );
};

// resolve database-authoritative runtime scopes
const getRuntimeAuthority = async (
  subject?: string
): Promise<{ generation: string; scopes: RuntimeAuthorityScope[] }> => {
  const policy = await SupporterAuthorityPolicy.findByPk(AUTHORITY_POLICY_ID);
  // missing policy guard
  if (!policy) {
    return { generation: "1", scopes: [] };
  }
  const sandboxAllowed =
    isEnabled("SUPPORTER_SANDBOX_RUNTIME_ENABLED") ||
    Boolean(
      subject &&
      (await FeatureFlagAllowlist.findOne({
        where: { name: SANDBOX_ALLOWLIST, subject },
      }))
    );
  const scopes = parseAuthoritySet(policy.authoritySet)
    .filter((entry) => entry.environment !== "sandbox" || sandboxAllowed)
    .map(({ environment, providerProjectKey }) => ({
      environment,
      providerProjectKey,
    }));
  return { generation: String(policy.generation), scopes };
};

// lock one customer row by subject
const findLockedCustomer = async (
  subject: string,
  transaction: Transaction
): Promise<SupporterCustomer | null> =>
  await SupporterCustomer.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { subject },
  });

/** Allocates one immutable pseudonymous RevenueCat App User ID. */
export const getOrCreateSupporterCustomer = async (
  subject: string,
  issuedAtSeconds: number
): Promise<SupporterCustomer> =>
  await db.transaction(async (transaction) => {
    await lockSubjectAuthorization(subject, transaction);
    // stale token guard
    if (
      await isApplicationTokenRevoked(
        subject,
        issuedAtSeconds,
        new Date(),
        transaction,
        true
      )
    ) {
      throw new SupporterAuthorizationError();
    }
    let customer = await findLockedCustomer(subject, transaction);
    // allocate one customer guard
    if (!customer) {
      customer = await SupporterCustomer.create(
        { id: randomUUID(), subject },
        { transaction }
      );
    }
    // post-wait revocation guard
    if (
      await isApplicationTokenRevoked(
        subject,
        issuedAtSeconds,
        new Date(),
        transaction,
        true
      )
    ) {
      throw new SupporterAuthorizationError();
    }
    return customer;
  });

// compare runtime-relevant provider projections
const getProjectionComparison = (
  subscriptions: Array<
    Pick<
      SupporterSubscription,
      | "billingIssueAt"
      | "currentPeriodEndsAt"
      | "lifecycleState"
      | "planInterval"
      | "productIdentifier"
      | "providerSubscriptionId"
      | "refundedAt"
      | "revokedAt"
      | "startsAt"
      | "store"
      | "willRenew"
    >
  >
): string =>
  JSON.stringify(
    subscriptions
      .map((subscription) => ({
        billingIssueAt: subscription.billingIssueAt?.toISOString() ?? null,
        currentPeriodEndsAt:
          subscription.currentPeriodEndsAt?.toISOString() ?? null,
        lifecycleState: subscription.lifecycleState,
        planInterval: subscription.planInterval,
        productIdentifier: subscription.productIdentifier,
        providerSubscriptionId: subscription.providerSubscriptionId,
        refundedAt: subscription.refundedAt?.toISOString() ?? null,
        revokedAt: subscription.revokedAt?.toISOString() ?? null,
        startsAt: subscription.startsAt?.toISOString() ?? null,
        store: subscription.store,
        willRenew: subscription.willRenew,
      }))
      .sort((left, right) =>
        left.providerSubscriptionId.localeCompare(right.providerSubscriptionId)
      )
  );

// select current entitlement sources
const getSupporterSources = (
  subscriptions: RevenueCatSubscriptionSnapshot[],
  now: Date
): RevenueCatSubscriptionSnapshot[] =>
  subscriptions.filter(
    (subscription) =>
      subscription.entitlementIdentifiers.includes(
        SUPPORTER_ENTITLEMENT_IDENTIFIER
      ) &&
      subscription.givesAccess &&
      (!subscription.activeUntil || subscription.activeUntil > now)
  );

// select aggregate lifecycle state
const getLifecycleState = (
  subscriptions: RevenueCatSubscriptionSnapshot[]
): SupporterLifecycleState => {
  const priorities: SupporterLifecycleState[] = [
    "grace",
    "billing-issue",
    "active",
    "cancelled-active",
    "revoked",
    "refunded",
    "expired",
    "unknown-inactive",
  ];
  // resolve the strongest lifecycle state
  for (const state of priorities) {
    // matching state guard
    if (
      subscriptions.some(
        (subscription) => subscription.lifecycleState === state
      )
    ) {
      return state;
    }
  }
  return "none";
};

// request one durable reconcile generation
const requestSupporterReconcileInTransaction = async (
  customerId: string,
  environment: SupporterEnvironment,
  providerProjectKey: string,
  transaction: Transaction
): Promise<string> => {
  await SupporterReconcileWork.findOrCreate({
    defaults: {
      customerId,
      environment,
      nextAttemptAt: new Date(),
      providerProjectKey,
    },
    transaction,
    where: { customerId, environment, providerProjectKey },
  });
  const work = await SupporterReconcileWork.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { customerId, environment, providerProjectKey },
  });
  // durable work guard
  if (!work) {
    throw new Error("Supporter reconcile work was unavailable");
  }
  const requestedGeneration = (
    BigInt(work.requestedGeneration) + BigInt(1)
  ).toString();
  const leaseIsActive =
    work.state === "running" &&
    Boolean(work.leaseExpiresAt && work.leaseExpiresAt > new Date());
  await work.update(
    {
      errorCode: null,
      nextAttemptAt: new Date(),
      requestedAt: new Date(),
      requestedGeneration,
      state: leaseIsActive ? "running" : "pending",
    },
    { transaction }
  );
  return requestedGeneration;
};

/** Requests one durable reconcile generation. */
export const requestSupporterReconcile = async (
  customerId: string,
  environment: SupporterEnvironment,
  providerProjectKey = REVENUECAT_PROVIDER_PROJECT_KEY,
  transaction?: Transaction
): Promise<string> => {
  // reuse an owning transaction
  if (transaction) {
    return await requestSupporterReconcileInTransaction(
      customerId,
      environment,
      providerProjectKey,
      transaction
    );
  }
  return await db.transaction(
    async (ownedTransaction) =>
      await requestSupporterReconcileInTransaction(
        customerId,
        environment,
        providerProjectKey,
        ownedTransaction
      )
  );
};

// claim one reconcile lease
const claimSupporterReconcile = async ({
  customerId,
  environment,
  providerProjectKey,
}: {
  customerId: string;
  environment: SupporterEnvironment;
  providerProjectKey: string;
}): Promise<{ generation: string; leaseToken: string } | null> =>
  await db.transaction(async (transaction) => {
    const work = await SupporterReconcileWork.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { customerId, environment, providerProjectKey },
    });
    const now = new Date();
    // claimable work guard
    if (
      !work ||
      BigInt(work.completedGeneration) >= BigInt(work.requestedGeneration) ||
      (work.state === "running" &&
        work.leaseExpiresAt &&
        work.leaseExpiresAt > now)
    ) {
      return null;
    }
    const leaseToken = randomUUID();
    const generation = work.requestedGeneration;
    await work.update(
      {
        attemptCount: work.attemptCount + 1,
        claimedGeneration: generation,
        leaseExpiresAt: new Date(now.getTime() + RECONCILE_LEASE_MS),
        leaseToken,
        startedAt: now,
        state: "running",
      },
      { transaction }
    );
    return { generation, leaseToken };
  });

// normalize persisted subscription values
const getSubscriptionValues = (
  customerId: string,
  environment: SupporterEnvironment,
  providerProjectKey: string,
  subscription: RevenueCatSubscriptionSnapshot
): Record<string, unknown> => ({
  billingIssueAt: subscription.billingIssueAt,
  currentPeriodEndsAt: subscription.activeUntil,
  customerId,
  environment,
  lifecycleState: subscription.lifecycleState,
  planInterval: subscription.planInterval,
  productIdentifier: subscription.productIdentifier,
  providerProjectKey,
  providerSubscriptionId: subscription.id,
  providerUpdatedAt: subscription.providerUpdatedAt,
  refundedAt: subscription.refundedAt,
  revokedAt: subscription.revokedAt,
  startsAt: subscription.startsAt,
  store: subscription.store,
  willRenew: subscription.willRenew,
});

// commit one fenced provider projection
const commitSupporterReconcile = async ({
  customerId,
  environment,
  generation,
  leaseToken,
  providerProjectKey,
  subscriptions,
}: {
  customerId: string;
  environment: SupporterEnvironment;
  generation: string;
  leaseToken: string;
  providerProjectKey: string;
  subscriptions: RevenueCatSubscriptionSnapshot[];
}): Promise<boolean> =>
  await db.transaction(async (transaction) => {
    const customer = await SupporterCustomer.findByPk(customerId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const work = await SupporterReconcileWork.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { customerId, environment, providerProjectKey },
    });
    // stale worker guard
    if (
      !customer ||
      !work ||
      work.leaseToken !== leaseToken ||
      work.claimedGeneration !== generation
    ) {
      return false;
    }
    const existingSubscriptions = await SupporterSubscription.findAll({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { customerId, environment, providerProjectKey },
    });
    const nextValues = subscriptions.map((subscription) =>
      getSubscriptionValues(
        customerId,
        environment,
        providerProjectKey,
        subscription
      )
    );
    const projectionChanged =
      getProjectionComparison(existingSubscriptions) !==
      getProjectionComparison(
        nextValues as Array<
          Pick<
            SupporterSubscription,
            | "billingIssueAt"
            | "currentPeriodEndsAt"
            | "lifecycleState"
            | "planInterval"
            | "productIdentifier"
            | "providerSubscriptionId"
            | "refundedAt"
            | "revokedAt"
            | "startsAt"
            | "store"
            | "willRenew"
          >
        >
      );
    await SupporterSubscription.destroy({
      transaction,
      where: { customerId, environment, providerProjectKey },
    });
    // replace the scoped sources
    if (nextValues.length > 0) {
      await SupporterSubscription.bulkCreate(nextValues, { transaction });
    }
    const now = new Date();
    const activeSources = getSupporterSources(subscriptions, now);
    const activeUntilValues = activeSources
      .map((subscription) => subscription.activeUntil)
      .filter((value): value is Date => Boolean(value));
    const activeUntil = activeUntilValues.length
      ? new Date(Math.max(...activeUntilValues.map((date) => date.getTime())))
      : null;
    const lifecycleState = getLifecycleState(
      activeSources.length > 0 ? activeSources : subscriptions
    );
    const existingEntitlement = await SupporterEntitlement.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: {
        customerId,
        entitlementIdentifier: SUPPORTER_ENTITLEMENT_IDENTIFIER,
        environment,
        providerProjectKey,
      },
    });
    const entitlementProjection = {
      accessState: activeSources.length > 0 ? "active" : "inactive",
      activeUntil,
      lifecycleState,
      primaryStore: activeSources[0]?.store ?? null,
      sourceCount: activeSources.length,
    } as const;
    const entitlementChanged =
      !existingEntitlement ||
      existingEntitlement.accessState !== entitlementProjection.accessState ||
      existingEntitlement.activeUntil?.toISOString() !==
        entitlementProjection.activeUntil?.toISOString() ||
      existingEntitlement.lifecycleState !==
        entitlementProjection.lifecycleState ||
      existingEntitlement.primaryStore !== entitlementProjection.primaryStore ||
      existingEntitlement.sourceCount !== entitlementProjection.sourceCount;
    await SupporterEntitlement.upsert(
      {
        ...entitlementProjection,
        customerId,
        entitlementIdentifier: SUPPORTER_ENTITLEMENT_IDENTIFIER,
        environment,
        lastReconciledAt: now,
        lastVerifiedAt: now,
        providerProjectKey,
        reconcileGeneration: generation,
      },
      { transaction }
    );
    // advance runtime revision once
    if (projectionChanged || entitlementChanged) {
      await customer.update(
        {
          runtimeProjectionGeneration: (
            BigInt(customer.runtimeProjectionGeneration) + BigInt(1)
          ).toString(),
        },
        { transaction }
      );
    }
    await work.update(
      {
        completedAt: now,
        completedGeneration: generation,
        errorCode: null,
        leaseExpiresAt: null,
        leaseToken: null,
        state:
          BigInt(work.requestedGeneration) > BigInt(generation)
            ? "pending"
            : "idle",
      },
      { transaction }
    );
    return true;
  });

// record one fixed reconcile failure
const failSupporterReconcile = async ({
  customerId,
  environment,
  leaseToken,
  providerProjectKey,
}: {
  customerId: string;
  environment: SupporterEnvironment;
  leaseToken: string;
  providerProjectKey: string;
}): Promise<void> => {
  await SupporterReconcileWork.update(
    {
      errorCode: "provider_unavailable",
      leaseExpiresAt: null,
      leaseToken: null,
      nextAttemptAt: new Date(Date.now() + RECONCILE_RETRY_MS),
      state: "failed",
    },
    { where: { customerId, environment, leaseToken, providerProjectKey } }
  );
};

/** Reconciles one durable provider scope with lease fencing. */
export const runSupporterReconcile = async ({
  customerId,
  environment,
  providerProjectKey = REVENUECAT_PROVIDER_PROJECT_KEY,
}: {
  customerId: string;
  environment: SupporterEnvironment;
  providerProjectKey?: string;
}): Promise<boolean> => {
  const claim = await claimSupporterReconcile({
    customerId,
    environment,
    providerProjectKey,
  });
  // duplicate runner guard
  if (!claim) {
    return false;
  }
  // isolate provider failure
  try {
    const subscriptions = await listRevenueCatSubscriptions(
      customerId,
      environment
    );
    return await commitSupporterReconcile({
      customerId,
      environment,
      generation: claim.generation,
      leaseToken: claim.leaseToken,
      providerProjectKey,
      subscriptions,
    });
  } catch (error) {
    await failSupporterReconcile({
      customerId,
      environment,
      leaseToken: claim.leaseToken,
      providerProjectKey,
    });
    throw error;
  }
};

// load one current runtime projection
const loadRuntimeProjection = async (
  subject: string,
  customer: SupporterCustomer,
  now = new Date()
): Promise<{
  authorityGeneration: string;
  projection: ProjectionState;
}> => {
  const authority = await getRuntimeAuthority(subject);
  const entitlements = authority.scopes.length
    ? await SupporterEntitlement.findAll({
        where: {
          [Op.or]: authority.scopes.map((scope) => ({
            environment: scope.environment,
            providerProjectKey: scope.providerProjectKey,
          })),
          customerId: customer.id,
          entitlementIdentifier: SUPPORTER_ENTITLEMENT_IDENTIFIER,
        },
      })
    : [];
  const activeEntitlements = entitlements.filter(
    (entitlement) =>
      entitlement.accessState === "active" &&
      (!entitlement.activeUntil || entitlement.activeUntil > now)
  );
  const subscriptions = authority.scopes.length
    ? await SupporterSubscription.findAll({
        where: {
          [Op.or]: authority.scopes.map((scope) => ({
            environment: scope.environment,
            providerProjectKey: scope.providerProjectKey,
          })),
          customerId: customer.id,
        },
      })
    : [];
  const activeSubscriptionStates = new Set<SupporterLifecycleState>([
    "active",
    "billing-issue",
    "cancelled-active",
    "grace",
  ]);
  const sources = subscriptions
    .filter(
      (subscription) =>
        activeSubscriptionStates.has(subscription.lifecycleState) &&
        (!subscription.currentPeriodEndsAt ||
          subscription.currentPeriodEndsAt > now)
    )
    .map(
      (subscription): SupporterSource => ({
        activeUntil: subscription.currentPeriodEndsAt?.toISOString() ?? null,
        lifecycleState: subscription.lifecycleState,
        planInterval: subscription.planInterval,
        productIdentifier: subscription.productIdentifier,
        store: subscription.store,
        willRenew: subscription.willRenew,
      })
    );
  const activeUntilValues = activeEntitlements
    .map((entitlement) => entitlement.activeUntil)
    .filter((value): value is Date => Boolean(value));
  return {
    authorityGeneration: authority.generation,
    projection: {
      active: activeEntitlements.length > 0,
      activeUntil: activeUntilValues.length
        ? new Date(Math.max(...activeUntilValues.map((date) => date.getTime())))
        : null,
      lifecycleState:
        activeEntitlements[0]?.lifecycleState ??
        entitlements[0]?.lifecycleState ??
        "none",
      sources,
    },
  };
};

/** Reads compact supporter state without allocating billing identity. */
export const getSupporterSummaryForSubject = async (
  subject: string
): Promise<SupporterSummary> => {
  const customer = await SupporterCustomer.findOne({ where: { subject } });
  const authority = await getRuntimeAuthority(subject);
  // unmapped account guard
  if (!customer) {
    return {
      active: false,
      activeUntil: null,
      adsEnabled: false,
      lifecycleState: "none",
      resolved: true,
      revision: `v1:0:${authority.generation}`,
    };
  }
  const { projection } = await loadRuntimeProjection(subject, customer);
  return {
    active: projection.active,
    activeUntil: projection.activeUntil?.toISOString() ?? null,
    adsEnabled: customer.adsEnabled,
    lifecycleState: projection.lifecycleState,
    resolved: true,
    revision: `v1:${customer.runtimeProjectionGeneration}:${authority.generation}`,
  };
};

/** Resolves production Supporter badges for a bounded subject collection. */
export const getActiveSupporterSubjects = async (
  subjects: string[],
  now = new Date()
): Promise<Set<string>> => {
  const uniqueSubjects = [...new Set(subjects)];
  // empty collection guard
  if (uniqueSubjects.length === 0) {
    return new Set();
  }
  const authority = await getRuntimeAuthority();
  const customers = await SupporterCustomer.findAll({
    where: { subject: { [Op.in]: uniqueSubjects } },
  });
  // mapped customer guard
  if (customers.length === 0 || authority.scopes.length === 0) {
    return new Set();
  }
  const subjectByCustomer = new Map(
    customers
      .filter((customer): customer is SupporterCustomer & { subject: string } =>
        Boolean(customer.subject)
      )
      .map((customer) => [customer.id, customer.subject])
  );
  const entitlements = await SupporterEntitlement.findAll({
    attributes: ["customerId"],
    where: {
      [Op.or]: authority.scopes.map((scope) => ({
        environment: scope.environment,
        providerProjectKey: scope.providerProjectKey,
      })),
      accessState: "active",
      activeUntil: { [Op.or]: [{ [Op.eq]: null }, { [Op.gt]: now }] },
      customerId: { [Op.in]: [...subjectByCustomer.keys()] },
      entitlementIdentifier: SUPPORTER_ENTITLEMENT_IDENTIFIER,
    },
  });
  return new Set(
    entitlements
      .map((entitlement) => subjectByCustomer.get(entitlement.customerId))
      .filter((subject): subject is string => Boolean(subject))
  );
};

/** Reads full supporter state for the authenticated purchase surface. */
export const getSupporterStatus = async (
  subject: string,
  issuedAtSeconds: number
): Promise<SupporterStatus> => {
  const customer = await getOrCreateSupporterCustomer(subject, issuedAtSeconds);
  const { authorityGeneration, projection } = await loadRuntimeProjection(
    subject,
    customer
  );
  const lastEntitlement = await SupporterEntitlement.findOne({
    order: [["lastVerifiedAt", "DESC"]],
    where: { customerId: customer.id },
  });
  const profile = await LeaderboardProfile.findByPk(subject);
  // default active unconfigured accounts on
  const supporterBadgeVisible = profile?.supporterBadgePreferenceSet
    ? profile.supporterBadgeVisible
    : projection.active;
  return {
    active: projection.active,
    activeUntil: projection.activeUntil?.toISOString() ?? null,
    adsEnabled: customer.adsEnabled,
    appUserId: customer.id,
    checkoutAvailability: {
      android: isEnabled("SUPPORTER_ANDROID_CHECKOUT_ENABLED"),
      ios: isEnabled("SUPPORTER_IOS_CHECKOUT_ENABLED"),
      web: isEnabled("SUPPORTER_WEB_CHECKOUT_ENABLED"),
    },
    degradedCode: null,
    lastReconciledAt: lastEntitlement?.lastReconciledAt.toISOString() ?? null,
    lastVerifiedAt: lastEntitlement?.lastVerifiedAt.toISOString() ?? null,
    lifecycleState: projection.lifecycleState,
    resolved: true,
    revision: `v1:${customer.runtimeProjectionGeneration}:${authorityGeneration}`,
    sources: projection.sources,
    supporterBadgeVisible,
  };
};

/** Persists one supporter account's voluntary ad preference. */
export const setSupporterAdsEnabled = async (
  subject: string,
  issuedAtSeconds: number,
  adsEnabled: boolean
): Promise<SupporterStatus> => {
  const customer = await getOrCreateSupporterCustomer(subject, issuedAtSeconds);
  // avoid an unnecessary preference write
  if (customer.adsEnabled !== adsEnabled) {
    await customer.update({ adsEnabled });
  }
  return await getSupporterStatus(subject, issuedAtSeconds);
};

/** Reconciles every current runtime scope for one authenticated account. */
export const reconcileSupporterSubject = async (
  subject: string,
  issuedAtSeconds: number
): Promise<SupporterStatus> => {
  const customer = await getOrCreateSupporterCustomer(subject, issuedAtSeconds);
  const authority = await getRuntimeAuthority(subject);
  // reconcile every authorized scope
  for (const scope of authority.scopes) {
    await requestSupporterReconcile(
      customer.id,
      scope.environment,
      scope.providerProjectKey
    );
    await runSupporterReconcile({
      customerId: customer.id,
      environment: scope.environment,
      providerProjectKey: scope.providerProjectKey,
    });
  }
  return await getSupporterStatus(subject, issuedAtSeconds);
};

/** Persists one verified webhook envelope and its reconcile targets. */
export const ingestRevenueCatWebhook = async (
  envelope: RevenueCatWebhookEnvelope,
  bodyHash: string
): Promise<{ duplicate: boolean; eventId: string }> =>
  await db.transaction(async (transaction) => {
    const [event, created] = await RevenueCatWebhookEvent.findOrCreate({
      defaults: {
        appId: envelope.appId,
        bodyHash,
        environment: envelope.environment,
        eventId: envelope.eventId,
        eventTimestamp: envelope.eventTimestamp,
        eventType: envelope.eventType,
        nextAttemptAt: new Date(),
        providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY,
        status: envelope.appUserIds.length > 0 ? "pending" : "succeeded",
        ...(envelope.appUserIds.length === 0
          ? { processedAt: new Date() }
          : {}),
      },
      transaction,
      where: {
        eventId: envelope.eventId,
        providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY,
      },
    });
    // idempotent duplicate guard
    if (!created) {
      // body collision guard
      if (event.bodyHash !== bodyHash) {
        throw new Error("RevenueCat event id reused with a different body");
      }
      return { duplicate: true, eventId: envelope.eventId };
    }
    // create every known customer target
    for (const appUserId of envelope.appUserIds) {
      const customer = await SupporterCustomer.findByPk(appUserId, {
        transaction,
      });
      // unknown provider customer guard
      if (!customer) {
        continue;
      }
      const requiredGeneration = await requestSupporterReconcile(
        customer.id,
        envelope.environment,
        REVENUECAT_PROVIDER_PROJECT_KEY,
        transaction
      );
      await RevenueCatWebhookEventTarget.create(
        {
          customerId: customer.id,
          environment: envelope.environment,
          eventId: envelope.eventId,
          providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY,
          requiredGeneration,
        },
        { transaction }
      );
    }
    return { duplicate: false, eventId: envelope.eventId };
  });

/** Processes every remaining target for one durable webhook event. */
export const processRevenueCatWebhookEvent = async (
  eventId: string
): Promise<void> => {
  const event = await RevenueCatWebhookEvent.findOne({
    where: { eventId, providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY },
  });
  // completed event guard
  if (!event || event.status === "succeeded") {
    return;
  }
  await event.update({
    attemptCount: event.attemptCount + 1,
    status: "processing",
  });
  const targets = await RevenueCatWebhookEventTarget.findAll({
    where: {
      eventId,
      providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY,
      status: { [Op.ne]: "succeeded" },
    },
  });
  // reconcile each event target
  for (const target of targets) {
    // isolate target failure
    try {
      await runSupporterReconcile({
        customerId: target.customerId,
        environment: target.environment,
        providerProjectKey: target.providerProjectKey,
      });
      const work = await SupporterReconcileWork.findOne({
        where: {
          customerId: target.customerId,
          environment: target.environment,
          providerProjectKey: target.providerProjectKey,
        },
      });
      // generation completion guard
      if (
        work &&
        BigInt(work.completedGeneration) >= BigInt(target.requiredGeneration)
      ) {
        await target.update({
          completedAt: new Date(),
          errorCode: null,
          status: "succeeded",
        });
      }
    } catch {
      await target.update({ errorCode: "reconcile_failed", status: "failed" });
    }
  }
  const remaining = await RevenueCatWebhookEventTarget.count({
    where: {
      eventId,
      providerProjectKey: REVENUECAT_PROVIDER_PROJECT_KEY,
      status: { [Op.ne]: "succeeded" },
    },
  });
  await event.update(
    remaining === 0
      ? { errorCode: null, processedAt: new Date(), status: "succeeded" }
      : {
          errorCode: "target_pending",
          nextAttemptAt: new Date(Date.now() + RECONCILE_RETRY_MS),
          status: "failed",
        }
  );
};

/** Recovers bounded pending supporter reconciliation and webhook work. */
export const processPendingSupporterWork = async (): Promise<void> => {
  const now = new Date();
  const works = await SupporterReconcileWork.findAll({
    limit: 20,
    order: [["nextAttemptAt", "ASC"]],
    where: {
      [Op.or]: [
        { state: ["pending", "failed"] },
        { leaseExpiresAt: { [Op.lte]: now }, state: "running" },
      ],
      nextAttemptAt: { [Op.lte]: now },
    },
  });
  // recover bounded provider work
  for (const work of works) {
    await runSupporterReconcile({
      customerId: work.customerId,
      environment: work.environment,
      providerProjectKey: work.providerProjectKey,
    }).catch(() => undefined);
  }
  const events = await RevenueCatWebhookEvent.findAll({
    limit: 20,
    order: [["nextAttemptAt", "ASC"]],
    where: {
      nextAttemptAt: { [Op.lte]: now },
      status: ["pending", "failed"],
    },
  });
  // recover bounded event work
  for (const event of events) {
    await processRevenueCatWebhookEvent(event.eventId);
  }
};

// derive one privacy-minimal ip principal
const getIpPrincipal = (ip: string): string => {
  const secret =
    process.env.SUPPORTER_ACTION_HMAC_SECRET ?? process.env.AUTH0_SERVER_SECRET;
  // action secret guard
  if (!secret) {
    throw new Error("Supporter action HMAC is not configured");
  }
  return `v1:${createHmac("sha256", secret)
    .update(`supporter-management-ip-v1:${ip}`)
    .digest("hex")}`;
};

// admit one durable fixed-window principal
const admitActionPrincipal = async ({
  limit,
  principalKey,
  principalKind,
  transaction,
  windowStart,
}: {
  limit: number;
  principalKey: string;
  principalKind: "account" | "ip";
  transaction: Transaction;
  windowStart: Date;
}): Promise<boolean> => {
  const [, metadata] = await db.query(
    `
      INSERT INTO "ProviderActionWindows"
        ("action", "principalKind", "principalKey", "fixedWindowStart", "count", "createdAt", "updatedAt")
      VALUES
        (:action, :principalKind, :principalKey, :windowStart, 1, NOW(), NOW())
      ON CONFLICT ("action", "principalKind", "principalKey", "fixedWindowStart")
      DO UPDATE SET
        "count" = "ProviderActionWindows"."count" + 1,
        "updatedAt" = NOW()
      WHERE "ProviderActionWindows"."count" < :limit
      RETURNING "count"
    `,
    {
      replacements: {
        action: MANAGEMENT_ACTION,
        limit,
        principalKey,
        principalKind,
        windowStart,
      },
      transaction,
    }
  );
  return Number((metadata as { rowCount?: number }).rowCount ?? 0) > 0;
};

// admit one account and ip management action
const admitManagementAction = async (
  customerId: string,
  ip: string,
  now = new Date()
): Promise<void> => {
  const windowStart = new Date(
    Math.floor(now.getTime() / MANAGEMENT_WINDOW_MS) * MANAGEMENT_WINDOW_MS
  );
  await db.transaction(async (transaction) => {
    const accountAllowed = await admitActionPrincipal({
      limit: MANAGEMENT_ACCOUNT_LIMIT,
      principalKey: customerId,
      principalKind: "account",
      transaction,
      windowStart,
    });
    // account limit guard
    if (!accountAllowed) {
      throw new SupporterRateLimitError(
        Math.ceil(
          (windowStart.getTime() + MANAGEMENT_WINDOW_MS - now.getTime()) / 1_000
        )
      );
    }
    const ipAllowed = await admitActionPrincipal({
      limit: MANAGEMENT_IP_LIMIT,
      principalKey: getIpPrincipal(ip),
      principalKind: "ip",
      transaction,
      windowStart,
    });
    // ip limit guard
    if (!ipAllowed) {
      throw new SupporterRateLimitError(
        Math.ceil(
          (windowStart.getTime() + MANAGEMENT_WINDOW_MS - now.getTime()) / 1_000
        )
      );
    }
  });
};

/** Creates one source-authorized RevenueCat Billing management URL. */
export const createSupporterManagementLink = async (
  subject: string,
  ip: string
): Promise<string> => {
  const customer = await SupporterCustomer.findOne({ where: { subject } });
  // mapped customer guard
  if (!customer) {
    throw new Error("No Supporter billing customer exists");
  }
  const authority = await getRuntimeAuthority(subject);
  // empty authority guard
  if (authority.scopes.length === 0) {
    throw new Error("Supporter runtime authority is unavailable");
  }
  const subscriptions = await SupporterSubscription.findAll({
    order: [["currentPeriodEndsAt", "DESC"]],
    where: {
      [Op.or]: authority.scopes.map((scope) => ({
        environment: scope.environment,
        providerProjectKey: scope.providerProjectKey,
      })),
      customerId: customer.id,
      lifecycleState: ["active", "billing-issue", "cancelled-active", "grace"],
      store: "rc_billing",
    },
  });
  const subscription = subscriptions.find(
    (value) =>
      !value.currentPeriodEndsAt || value.currentPeriodEndsAt > new Date()
  );
  // active web source guard
  if (!subscription) {
    throw new Error("No manageable RevenueCat Billing subscription exists");
  }
  await admitManagementAction(customer.id, ip);
  return await createRevenueCatManagementUrl(
    subscription.providerSubscriptionId
  );
};

/** Detaches billing identity while retaining provider lifecycle audit state. */
export const detachSupporterCustomer = async (
  subject: string,
  transaction: Transaction
): Promise<void> => {
  const customer = await findLockedCustomer(subject, transaction);
  // mapped customer guard
  if (!customer) {
    return;
  }
  await customer.update(
    {
      detachedAt: new Date(),
      runtimeProjectionGeneration: (
        BigInt(customer.runtimeProjectionGeneration) + BigInt(1)
      ).toString(),
      subject: null,
    },
    { transaction }
  );
};

/** Deletes fixed-window provider admission rows older than ten minutes. */
export const cleanupProviderActionWindows = async (): Promise<number> => {
  const [, metadata] = await db.query(
    `
      DELETE FROM "ProviderActionWindows"
      WHERE ctid IN (
        SELECT ctid
        FROM "ProviderActionWindows"
        WHERE "fixedWindowStart" <= NOW() - INTERVAL '10 minutes'
        LIMIT 5000
      )
    `
  );
  return Number((metadata as { rowCount?: number }).rowCount ?? 0);
};
