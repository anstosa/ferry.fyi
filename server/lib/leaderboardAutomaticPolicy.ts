import { Op, type Transaction } from "sequelize";

import { db } from "~/lib/db";
import { FeatureFlag } from "~/models/FeatureFlag";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";
import { LeaderboardAutomaticCandidateReceipt } from "~/models/LeaderboardAutomaticCandidateReceipt";
import { LeaderboardAutomaticEnrollment } from "~/models/LeaderboardAutomaticEnrollment";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";

export const LEADERBOARDS_FLAG = "leaderboards";
export const AUTOMATIC_LEADERBOARD_CHECKINS_FLAG =
  "automaticLeaderboardCheckins";
export const LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS = 3;

const MAX_SAFE_POLICY_GENERATION = Number.MAX_SAFE_INTEGER;

export interface LeaderboardAutomaticPolicyLockOptions {
  candidateKey?: string;
  createProfile?: boolean;
  enrollmentId?: string;
  lockCheckins?: boolean;
  lockPresence?: boolean;
  lockReceipts?: boolean;
  sailingId?: string;
  subject?: string;
  terminalId?: string;
}

/** proof locks acquired only after a receipt exists */
export interface LeaderboardAutomaticProofLockOptions {
  createPresence?: boolean;
  lockCheckins?: boolean;
  lockPresence?: boolean;
  sailingId?: string;
  subject: string;
  terminalId?: string;
}

export interface LockedLeaderboardAutomaticPolicy {
  automaticAllowlisted: boolean;
  automaticFlag: FeatureFlag;
  checkins: LeaderboardCheckin[];
  enrollments: LeaderboardAutomaticEnrollment[];
  parentAllowlisted: boolean;
  parentFlag: FeatureFlag;
  presences: LeaderboardTerminalPresence[];
  profile: LeaderboardProfile | null;
  receipts: LeaderboardAutomaticCandidateReceipt[];
  transaction: Transaction;
}

/** receipt-ordered proof state */
export interface LockedLeaderboardAutomaticProofState {
  checkins: LeaderboardCheckin[];
  presences: LeaderboardTerminalPresence[];
}

export interface EffectiveLeaderboardAutomaticPolicy {
  automaticEnabled: boolean;
  automaticFlagEnabled: boolean;
  enrollmentActive: boolean;
  manualEnabled: boolean;
  parentFlagEnabled: boolean;
  serverPolicyGeneration: number;
}

// match only postgres transaction rollback states
const isRetryableTransactionSqlState = (value: unknown): boolean =>
  value === "40001" || value === "40P01";

// find retryable sqlstate through sequelize error wrappers
const hasRetryableTransactionSqlState = (
  error: unknown,
  visited = new WeakSet<object>()
): boolean => {
  // reject primitive and cyclic wrapper nodes
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null ||
    visited.has(error)
  ) {
    return false;
  }

  // prevent repeated cause traversal
  visited.add(error);
  const record = error as Record<string, unknown>;

  // accept a direct postgres sqlstate
  if (isRetryableTransactionSqlState(record.code)) {
    return true;
  }

  return (
    hasRetryableTransactionSqlState(record.parent, visited) ||
    hasRetryableTransactionSqlState(record.original, visited) ||
    hasRetryableTransactionSqlState(record.cause, visited)
  );
};

// lock one feature row deterministically
const lockFeatureFlag = async (
  name: string,
  transaction: Transaction
): Promise<FeatureFlag> => {
  const [flag] = await FeatureFlag.findOrCreate({
    defaults: {
      enabled: false,
      killSwitch: false,
      name,
      serverPolicyGeneration: 0,
    },
    transaction,
    where: { name },
  });
  await flag.reload({ lock: transaction.LOCK.UPDATE, transaction });
  return flag;
};

// lock or create one subject profile
const lockProfile = async (
  subject: string,
  createProfile: boolean,
  transaction: Transaction
): Promise<LeaderboardProfile | null> => {
  // create only for profile-bearing operations
  if (createProfile) {
    const [profile] = await LeaderboardProfile.findOrCreate({
      defaults: {
        automaticCheckinsEnabled: false,
        displayName: "",
        notificationsEnabled: true,
        optedOut: false,
        subject,
        supporterBadgePreferenceSet: false,
        supporterBadgeVisible: true,
        useFullName: false,
        verboseNotificationsEnabled: false,
      },
      transaction,
      where: { subject },
    });
    await profile.reload({ lock: transaction.LOCK.UPDATE, transaction });
    return profile;
  }

  return await LeaderboardProfile.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { subject },
  });
};

// read one allowlist entry while its flag row is held
const isAllowlisted = async (
  name: string,
  subject: string,
  transaction: Transaction
): Promise<boolean> =>
  Boolean(
    await FeatureFlagAllowlist.findOne({
      transaction,
      where: { name, subject },
    })
  );

// lock enrollments after the profile
const lockEnrollments = async (
  options: LeaderboardAutomaticPolicyLockOptions,
  transaction: Transaction
): Promise<LeaderboardAutomaticEnrollment[]> => {
  // skip identity locks without a subject
  if (!options.subject) {
    return [];
  }

  return await LeaderboardAutomaticEnrollment.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [["enrollmentId", "ASC"]],
    transaction,
    where: {
      ...(options.enrollmentId ? { enrollmentId: options.enrollmentId } : {}),
      subject: options.subject,
    },
  });
};

// lock receipts after their enrollment rows
const lockReceipts = async (
  enrollments: LeaderboardAutomaticEnrollment[],
  options: LeaderboardAutomaticPolicyLockOptions,
  transaction: Transaction
): Promise<LeaderboardAutomaticCandidateReceipt[]> => {
  // project ordered enrollment identities
  const enrollmentIds = enrollments.map(({ enrollmentId }) => enrollmentId);

  // skip receipt locks unless requested and addressable
  if (!options.lockReceipts || enrollmentIds.length === 0) {
    return [];
  }

  return await LeaderboardAutomaticCandidateReceipt.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [["id", "ASC"]],
    transaction,
    where: {
      ...(options.candidateKey ? { candidateKey: options.candidateKey } : {}),
      enrollmentId: { [Op.in]: enrollmentIds },
    },
  });
};

// lock terminal presence after receipts
const lockPresences = async (
  options: {
    createPresence?: boolean;
    lockPresence?: boolean;
    subject?: string;
    terminalId?: string;
  },
  transaction: Transaction
): Promise<LeaderboardTerminalPresence[]> => {
  // skip presence locks unless requested for a subject
  if (!options.lockPresence || !options.subject) {
    return [];
  }

  // create an addressable presence before check-in locks
  if (options.createPresence && options.terminalId) {
    const [presence] = await LeaderboardTerminalPresence.findOrCreate({
      defaults: {
        exitedAt: null,
        lastCreditedAt: null,
        lastObservedAt: null,
        subject: options.subject,
        terminalId: options.terminalId,
      },
      transaction,
      where: {
        subject: options.subject,
        terminalId: options.terminalId,
      },
    });
    await presence.reload({ lock: transaction.LOCK.UPDATE, transaction });
    return [presence];
  }

  return await LeaderboardTerminalPresence.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [["terminalId", "ASC"]],
    transaction,
    where: {
      subject: options.subject,
      ...(options.terminalId ? { terminalId: options.terminalId } : {}),
    },
  });
};

// lock check-in uniqueness rows last
const lockCheckins = async (
  options: {
    lockCheckins?: boolean;
    sailingId?: string;
    subject?: string;
  },
  transaction: Transaction
): Promise<LeaderboardCheckin[]> => {
  // skip check-in locks unless requested for a subject
  if (!options.lockCheckins || !options.subject) {
    return [];
  }

  return await LeaderboardCheckin.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [["id", "ASC"]],
    transaction,
    where: {
      subject: options.subject,
      ...(options.sailingId ? { sailingId: options.sailingId } : {}),
    },
  });
};

/** locks policy state in the one global order */
export const lockLeaderboardAutomaticPolicy = async (
  transaction: Transaction,
  options: LeaderboardAutomaticPolicyLockOptions = {}
): Promise<LockedLeaderboardAutomaticPolicy> => {
  const parentFlag = await lockFeatureFlag(LEADERBOARDS_FLAG, transaction);
  const automaticFlag = await lockFeatureFlag(
    AUTOMATIC_LEADERBOARD_CHECKINS_FLAG,
    transaction
  );
  // read optional parent admission
  const parentAllowlisted = options.subject
    ? await isAllowlisted(LEADERBOARDS_FLAG, options.subject, transaction)
    : false;
  // read optional automatic admission
  const automaticAllowlisted = options.subject
    ? await isAllowlisted(
        AUTOMATIC_LEADERBOARD_CHECKINS_FLAG,
        options.subject,
        transaction
      )
    : false;
  // lock optional subject profile
  const profile = options.subject
    ? await lockProfile(
        options.subject,
        options.createProfile ?? false,
        transaction
      )
    : null;
  const enrollments = await lockEnrollments(options, transaction);
  const receipts = await lockReceipts(enrollments, options, transaction);
  const presences = await lockPresences(options, transaction);
  const checkins = await lockCheckins(options, transaction);

  return {
    automaticAllowlisted,
    automaticFlag,
    checkins,
    enrollments,
    parentAllowlisted,
    parentFlag,
    presences,
    profile,
    receipts,
    transaction,
  };
};

/** runs one retry-bounded policy-linearized database transaction */
export const withLeaderboardAutomaticPolicyTransaction = async <T>(
  options: LeaderboardAutomaticPolicyLockOptions,
  callback: (policy: LockedLeaderboardAutomaticPolicy) => Promise<T>
): Promise<T> => {
  // restart the complete transaction within the fixed bound
  for (
    let attempt = 1;
    attempt <= LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    // enter one fresh database transaction
    try {
      return await db.transaction(async (transaction) => {
        // re-establish the global lock order
        const policy = await lockLeaderboardAutomaticPolicy(
          transaction,
          options
        );
        return await callback(policy);
      });
    } catch (error) {
      // rethrow non-transaction or exhausted failures unchanged
      if (
        !hasRetryableTransactionSqlState(error) ||
        attempt === LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS
      ) {
        throw error;
      }
    }
  }

  // keep the fixed positive retry bound exhaustive
  throw new Error("Automatic policy transaction retry bound is invalid");
};

/** acquires presence then check-in proof locks after receipt creation */
export const lockLeaderboardAutomaticProofState = async (
  policy: LockedLeaderboardAutomaticPolicy,
  options: LeaderboardAutomaticProofLockOptions
): Promise<LockedLeaderboardAutomaticProofState> => {
  // require an already locked or newly inserted receipt
  if (policy.receipts.length === 0) {
    throw new Error("automatic candidate receipt lock unavailable");
  }

  const presences = await lockPresences(options, policy.transaction);
  const checkins = await lockCheckins(options, policy.transaction);
  return { checkins, presences };
};

// normalize one bigint-backed generation
const policyGenerationNumber = (value: number | string): number => {
  const generation = typeof value === "string" ? Number(value) : value;

  // reject unsafe persisted policy state
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation > MAX_SAFE_POLICY_GENERATION
  ) {
    throw new Error("Invalid server policy generation");
  }

  return generation;
};

/** returns the transaction-locked server policy generation */
export const getServerPolicyGeneration = (
  policy: LockedLeaderboardAutomaticPolicy
): number =>
  policyGenerationNumber(policy.automaticFlag.serverPolicyGeneration);

/** advances only the monotonic server policy generation */
export const advanceServerPolicyGeneration = async (
  policy: LockedLeaderboardAutomaticPolicy
): Promise<number> => {
  const current = getServerPolicyGeneration(policy);

  // fail closed at safe-integer exhaustion
  if (current === MAX_SAFE_POLICY_GENERATION) {
    throw new Error("Server policy generation exhausted");
  }

  const next = current + 1;
  await policy.automaticFlag.update(
    { serverPolicyGeneration: next },
    { transaction: policy.transaction }
  );
  return next;
};

// apply kill-before-global-before-allowlist precedence
const subjectFlagEnabled = (flag: FeatureFlag, allowlisted: boolean): boolean =>
  !flag.killSwitch && (flag.enabled || allowlisted);

/** checks one active healthy detector enrollment */
export const isHealthyAutomaticEnrollment = (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date
): boolean =>
  enrollment.health === "healthy" &&
  enrollment.revokedAt === null &&
  enrollment.tokenExpiresAt.getTime() > now.getTime() &&
  enrollment.detectorEnabled;

/** checks whether preference enablement has a healthy native boundary */
export const hasHealthyAutomaticEnrollment = (
  policy: LockedLeaderboardAutomaticPolicy,
  now: Date
): boolean =>
  // accept any healthy enrollment
  policy.enrollments.some((enrollment) =>
    isHealthyAutomaticEnrollment(enrollment, now)
  );

/** evaluates manual and automatic precedence from locked rows */
export const evaluateLeaderboardAutomaticPolicy = (
  policy: LockedLeaderboardAutomaticPolicy,
  now: Date,
  enrollment?: LeaderboardAutomaticEnrollment
): EffectiveLeaderboardAutomaticPolicy => {
  const parentFlagEnabled = subjectFlagEnabled(
    policy.parentFlag,
    policy.parentAllowlisted
  );
  const automaticFlagEnabled = subjectFlagEnabled(
    policy.automaticFlag,
    policy.automaticAllowlisted
  );
  // select the addressed enrollment
  const selectedEnrollment = enrollment ?? policy.enrollments[0];
  // fail closed without active enrollment
  const enrollmentActive = selectedEnrollment
    ? isHealthyAutomaticEnrollment(selectedEnrollment, now)
    : false;
  const manualEnabled = parentFlagEnabled && policy.profile?.optedOut !== true;
  const automaticEnabled =
    manualEnabled &&
    automaticFlagEnabled &&
    policy.profile?.automaticCheckinsEnabled === true &&
    enrollmentActive;

  return {
    automaticEnabled,
    automaticFlagEnabled,
    enrollmentActive,
    manualEnabled,
    parentFlagEnabled,
    serverPolicyGeneration: getServerPolicyGeneration(policy),
  };
};
