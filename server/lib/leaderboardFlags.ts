import { FeatureFlag } from "~/models/FeatureFlag";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";

export const LEADERBOARDS_FLAG = "leaderboards";
const AUTOMATIC_CHECKINS_FLAG = "automaticLeaderboardCheckins";

/** Only these flags may be made available privately to named subjects. */
const SUBJECT_AWARE_FLAGS = new Set([LEADERBOARDS_FLAG]);

export interface FeatureFlagState {
  enabled: boolean;
  killSwitch: boolean;
  name: string;
  subjects: string[];
}

const getFlag = async (name: string): Promise<FeatureFlag> => {
  const [flag] = await FeatureFlag.findOrCreate({
    defaults: { enabled: false, killSwitch: false, name },
    where: { name },
  });
  return flag;
};

/** Public/static evaluation never exposes an allowlisted feature. */
export const isPublicFeatureEnabled = async (
  name: string
): Promise<boolean> => {
  const flag = await getFlag(name);
  return flag.enabled && !flag.killSwitch;
};

/**
 * Authenticated evaluation: an active kill switch wins, then global enablement,
 * then an explicit allowlist entry for supported flags.
 */
export const isFeatureEnabledForSubject = async (
  name: string,
  subject: string
): Promise<boolean> => {
  const flag = await getFlag(name);
  if (flag.killSwitch) {
    return false;
  }
  if (flag.enabled) {
    return true;
  }
  if (!SUBJECT_AWARE_FLAGS.has(name)) {
    return false;
  }
  return Boolean(
    await FeatureFlagAllowlist.findOne({ where: { name, subject } })
  );
};

export const leaderboardsEnabled = (): Promise<boolean> =>
  isPublicFeatureEnabled(LEADERBOARDS_FLAG);
export const leaderboardsEnabledForSubject = (
  subject: string
): Promise<boolean> => isFeatureEnabledForSubject(LEADERBOARDS_FLAG, subject);

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
    subjects: allowlist.map(({ subject }) => subject),
  };
};

const normalizeSubjects = (subjects: string[]): string[] => [
  ...new Set(subjects.map((subject) => subject.trim()).filter(Boolean)),
];

export const setFeatureFlagState = async (
  name: string,
  state: Pick<FeatureFlagState, "enabled" | "killSwitch" | "subjects">
): Promise<FeatureFlagState> => {
  const flag = await getFlag(name);
  const subjects = normalizeSubjects(state.subjects);
  await flag.update({ enabled: state.enabled, killSwitch: state.killSwitch });
  if (SUBJECT_AWARE_FLAGS.has(name)) {
    await FeatureFlagAllowlist.destroy({ where: { name } });
    if (subjects.length) {
      await FeatureFlagAllowlist.bulkCreate(
        subjects.map((subject) => ({ name, subject }))
      );
    }
  }
  return getFeatureFlagState(name);
};

export const setLeaderboardsEnabled = async (
  enabled: boolean
): Promise<boolean> => {
  const flag = await getFlag(LEADERBOARDS_FLAG);
  if (flag.enabled !== enabled) {
    await flag.update({ enabled });
  }
  return enabled;
};

/** Automatic/background check-ins are permanently unavailable in this release. */
export const automaticLeaderboardCheckinsEnabled = async (): Promise<boolean> =>
  false;
export const setAutomaticLeaderboardCheckinsEnabled = async (
  _enabled: boolean
): Promise<boolean> => {
  const flag = await getFlag(AUTOMATIC_CHECKINS_FLAG);
  if (flag.enabled) {
    await flag.update({ enabled: false });
  }
  return false;
};

/** Compatibility response used by old public/admin clients. */
export const getLeaderboardFlags = async (): Promise<{
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
}> => ({
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled: await leaderboardsEnabled(),
});

export const getFeatureFlagsForSubject = async (subject: string) => ({
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled: await leaderboardsEnabledForSubject(subject),
});
