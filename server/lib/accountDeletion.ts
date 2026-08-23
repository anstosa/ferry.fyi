import type { Transaction } from "sequelize";
import type { AccountDeletionResult } from "shared/contracts/user";

import {
  lockSubjectAuthorization,
  revokeApplicationTokens,
} from "~/lib/admin/sessionRevocation";
import { deleteAuth0User } from "~/lib/auth0Admin";
import { db } from "~/lib/db";
import { lockLeaderboardAutomaticPolicy } from "~/lib/leaderboardAutomaticPolicy";
import { anonymizeLeaderboardAccount } from "~/lib/leaderboardPrivacy";
import { detachSupporterCustomer } from "~/lib/supporter";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";
import { SupporterCustomer } from "~/models/SupporterCustomer";
import { SupporterReconcileWork } from "~/models/SupporterReconcileWork";
import { SupporterSubscription } from "~/models/SupporterSubscription";
import { UserSettings } from "~/models/UserSettings";
import { UserTicket } from "~/models/UserTicket";

export interface DeletedUserDataResult {
  /** retains the Auth0 identity */
  auth0Identity: "retained";
  /** repeat-safe completion */
  status: "complete";
}

export class ContinuingBillingAcknowledgementRequiredError extends Error {
  // fixed deletion warning error
  constructor() {
    super("Continuing billing acknowledgement is required");
    this.name = "ContinuingBillingAcknowledgementRequiredError";
  }
}

// lock and evaluate continuing billing state
const requiresContinuingBillingAcknowledgement = async (
  subject: string,
  transaction: Transaction
): Promise<boolean> => {
  const customer = await SupporterCustomer.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { subject },
  });
  // unmapped customer guard
  if (!customer) {
    return false;
  }
  const works = await SupporterReconcileWork.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [
      ["providerProjectKey", "ASC"],
      ["environment", "ASC"],
    ],
    transaction,
    where: { customerId: customer.id },
  });
  const subscriptions = await SupporterSubscription.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [
      ["providerProjectKey", "ASC"],
      ["providerSubscriptionId", "ASC"],
    ],
    transaction,
    where: { customerId: customer.id },
  });
  const activeStates = new Set([
    "active",
    "billing-issue",
    "cancelled-active",
    "grace",
  ]);
  return (
    works.some((work) => work.state !== "idle") ||
    subscriptions.some(
      (subscription) =>
        activeStates.has(subscription.lifecycleState) &&
        (!subscription.currentPeriodEndsAt ||
          subscription.currentPeriodEndsAt > new Date())
    )
  );
};

// shared identifying-data deletion
const deleteFerryUserDataInTransaction = async (
  subject: string,
  transaction: Transaction,
  options: {
    continuingBillingAcknowledged: boolean;
    requireContinuingBillingAcknowledgement: boolean;
  }
): Promise<void> => {
  await lockSubjectAuthorization(subject, transaction);
  const policy = await lockLeaderboardAutomaticPolicy(transaction, {
    lockCheckins: true,
    lockPresence: true,
    lockReceipts: true,
    subject,
  });
  // continuing billing guard
  if (
    options.requireContinuingBillingAcknowledgement &&
    !options.continuingBillingAcknowledged &&
    (await requiresContinuingBillingAcknowledgement(subject, transaction))
  ) {
    throw new ContinuingBillingAcknowledgementRequiredError();
  }
  // commit revocation with deletion
  await revokeApplicationTokens(subject, new Date(), transaction);
  await detachSupporterCustomer(subject, transaction);
  await anonymizeLeaderboardAccount(subject, transaction, policy);

  await Promise.all([
    UserSettings.destroy({ transaction, where: { subject } }),
    UserTicket.destroy({ transaction, where: { subject } }),
    // remove feature allowlist link
    FeatureFlagAllowlist.destroy({ transaction, where: { subject } }),
  ]);
};

/** removes app-owned identity state while retaining Auth0 */
export const deleteFerryUserData = async (
  subject: string
): Promise<DeletedUserDataResult> => {
  // run app deletion atomically
  await db.transaction((transaction) =>
    deleteFerryUserDataInTransaction(subject, transaction, {
      continuingBillingAcknowledged: true,
      requireContinuingBillingAcknowledgement: false,
    })
  );

  return { auth0Identity: "retained", status: "complete" };
};

/** permanently removes a Ferry FYI account */
export const deleteFerryUserAccount = async (
  subject: string,
  continuingBillingAcknowledged = false
): Promise<AccountDeletionResult> => {
  // bind app and identity deletion
  await db.transaction(async (transaction) => {
    await deleteFerryUserDataInTransaction(subject, transaction, {
      continuingBillingAcknowledged,
      requireContinuingBillingAcknowledgement: true,
    });
    // preserve retry on Auth0 failure
    await deleteAuth0User(subject);
  });

  return { status: "complete" };
};
