import type { Transaction } from "sequelize";

import {
  advanceServerPolicyGeneration,
  AUTOMATIC_LEADERBOARD_CHECKINS_FLAG,
  LEADERBOARDS_FLAG,
  type LockedLeaderboardAutomaticPolicy,
  withLeaderboardAutomaticPolicyTransaction,
} from "~/lib/leaderboardAutomaticPolicy";
import { FeatureFlag } from "~/models/FeatureFlag";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";

export { LEADERBOARDS_FLAG };
export const AUTOMATIC_CHECKINS_FLAG = AUTOMATIC_LEADERBOARD_CHECKINS_FLAG;

/** only named subjects may receive private feature access */
const SUBJECT_AWARE_FLAGS = new Set([
  LEADERBOARDS_FLAG,
  AUTOMATIC_CHECKINS_FLAG,
]);

export interface FeatureFlagState {
  enabled: boolean;
  killSwitch: boolean;
  name: string;
  subjects: string[];
}

export type FeatureFlagStateUpdate = Partial<
  Pick<FeatureFlagState, "enabled" | "killSwitch" | "subjects">
>;

// load one feature flag
const getFlag = async (
  name: string,
  transaction?: Transaction
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
  return flag;
};

/** public evaluation ignores allowlists */
export const isPublicFeatureEnabled = async (
  name: string
): Promise<boolean> => {
  const flag = await getFlag(name);
  return flag.enabled && !flag.killSwitch;
};

/** evaluates kill, global, then subject access */
export const isFeatureEnabledForSubject = async (
  name: string,
  subject: string
): Promise<boolean> => {
  const flag = await getFlag(name);

  // kill wins globally
  if (flag.killSwitch) {
    return false;
  }

  // global enablement wins next
  if (flag.enabled) {
    return true;
  }

  // unknown flags remain global-only
  if (!SUBJECT_AWARE_FLAGS.has(name)) {
    return false;
  }

  return Boolean(
    await FeatureFlagAllowlist.findOne({ where: { name, subject } })
  );
};

// evaluate public manual access
export const leaderboardsEnabled = (): Promise<boolean> =>
  isPublicFeatureEnabled(LEADERBOARDS_FLAG);

// evaluate subject manual access
export const leaderboardsEnabledForSubject = (
  subject: string
): Promise<boolean> => isFeatureEnabledForSubject(LEADERBOARDS_FLAG, subject);

/** returns one admin feature state */
export const getFeatureFlagState = async (
  name: string
): Promise<FeatureFlagState> => {
  const [flag, allowlist] = await Promise.all([
    getFlag(name),
    FeatureFlagAllowlist.findAll({
      attributes: ["subject"],
      order: [["subject", "ASC"]],
      where: { name },
    }),
  ]);
  return {
    enabled: flag.enabled,
    killSwitch: flag.killSwitch,
    name,
    // project normalized subject identities
    subjects: allowlist.map(({ subject }) => subject),
  };
};

// normalize subject identities
const normalizeSubjects = (subjects: string[]): string[] =>
  [
    ...new Set(
      subjects
        // trim subject identities
        .map((subject) => subject.trim())
        // remove empty identities
        .filter(Boolean)
    ),
  ].sort();

// compare ordered subject lists
const subjectsEqual = (left: string[], right: string[]): boolean =>
  // compare each stable position
  left.length === right.length &&
  left.every((subject, index) => subject === right[index]);

// select one already-locked feature row
const lockedFlag = (
  name: string,
  policy: LockedLeaderboardAutomaticPolicy
): FeatureFlag => {
  // map the parent row
  if (name === LEADERBOARDS_FLAG) {
    return policy.parentFlag;
  }

  // map the automatic row
  if (name === AUTOMATIC_CHECKINS_FLAG) {
    return policy.automaticFlag;
  }

  throw new Error(`Unsupported subject-aware feature flag: ${name}`);
};

/** merges one feature policy atomically */
export const updateFeatureFlagState = async (
  name: string,
  update: FeatureFlagStateUpdate
): Promise<FeatureFlagState> => {
  // fail closed for unmanaged policy flags
  if (!SUBJECT_AWARE_FLAGS.has(name)) {
    throw new Error(`Unsupported subject-aware feature flag: ${name}`);
  }

  // mutate only after global policy locks
  return await withLeaderboardAutomaticPolicyTransaction({}, async (policy) => {
    const flag = lockedFlag(name, policy);
    const currentAllowlist = await FeatureFlagAllowlist.findAll({
      attributes: ["subject"],
      order: [["subject", "ASC"]],
      transaction: policy.transaction,
      where: { name },
    });
    // project currently locked subjects
    const currentSubjects = currentAllowlist.map(({ subject }) => subject);
    const enabled = update.enabled ?? flag.enabled;
    const killSwitch = update.killSwitch ?? flag.killSwitch;
    // preserve omitted subject state
    const subjects = update.subjects
      ? normalizeSubjects(update.subjects)
      : currentSubjects;
    const changed =
      flag.enabled !== enabled ||
      flag.killSwitch !== killSwitch ||
      !subjectsEqual(currentSubjects, subjects);

    // preserve generation for no-op writes
    if (!changed) {
      return {
        enabled: flag.enabled,
        killSwitch: flag.killSwitch,
        name,
        subjects: currentSubjects,
      };
    }

    await flag.update(
      { enabled, killSwitch },
      { transaction: policy.transaction }
    );
    await FeatureFlagAllowlist.destroy({
      transaction: policy.transaction,
      where: { name },
    });

    // replace explicit subject access
    if (subjects.length > 0) {
      await FeatureFlagAllowlist.bulkCreate(
        // build replacement allowlist rows
        subjects.map((subject) => ({ name, subject })),
        { transaction: policy.transaction }
      );
    }

    await advanceServerPolicyGeneration(policy);
    return {
      enabled,
      killSwitch,
      name,
      subjects,
    };
  });
};

/** replaces one complete feature policy atomically */
export const setFeatureFlagState = async (
  name: string,
  state: Pick<FeatureFlagState, "enabled" | "killSwitch" | "subjects">
): Promise<FeatureFlagState> => await updateFeatureFlagState(name, state);

/** changes only manual global enablement */
export const setLeaderboardsEnabled = async (
  enabled: boolean
): Promise<boolean> => {
  await updateFeatureFlagState(LEADERBOARDS_FLAG, { enabled });
  return enabled;
};

// evaluate public automatic access through its parent
export const automaticLeaderboardCheckinsEnabled = async (): Promise<boolean> =>
  (await isPublicFeatureEnabled(LEADERBOARDS_FLAG)) &&
  (await isPublicFeatureEnabled(AUTOMATIC_CHECKINS_FLAG));

// evaluate subject automatic access through its parent
export const automaticLeaderboardCheckinsEnabledForSubject = async (
  subject: string
): Promise<boolean> =>
  (await isFeatureEnabledForSubject(LEADERBOARDS_FLAG, subject)) &&
  (await isFeatureEnabledForSubject(AUTOMATIC_CHECKINS_FLAG, subject));

/** changes only automatic global enablement */
export const setAutomaticLeaderboardCheckinsEnabled = async (
  enabled: boolean
): Promise<boolean> => {
  await updateFeatureFlagState(AUTOMATIC_CHECKINS_FLAG, { enabled });
  return enabled;
};

/** returns anonymous global-only feature decisions */
export const getLeaderboardFlags = async (): Promise<{
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
}> => {
  const [manual, automatic] = await Promise.all([
    isPublicFeatureEnabled(LEADERBOARDS_FLAG),
    isPublicFeatureEnabled(AUTOMATIC_CHECKINS_FLAG),
  ]);
  return {
    automaticLeaderboardCheckinsEnabled: manual && automatic,
    leaderboardsEnabled: manual,
  };
};

/** returns subject-aware parent-gated decisions */
export const getFeatureFlagsForSubject = async (subject: string) => {
  const [manual, automatic] = await Promise.all([
    isFeatureEnabledForSubject(LEADERBOARDS_FLAG, subject),
    isFeatureEnabledForSubject(AUTOMATIC_CHECKINS_FLAG, subject),
  ]);
  return {
    automaticLeaderboardCheckinsEnabled: manual && automatic,
    leaderboardsEnabled: manual,
  };
};
