import { FeatureFlag } from "~/models/FeatureFlag";

const LEADERBOARDS_FLAG = "leaderboards";
const AUTOMATIC_CHECKINS_FLAG = "automaticLeaderboardCheckins";

const getFlag = async (name: string): Promise<boolean> => {
  const [flag] = await FeatureFlag.findOrCreate({
    defaults: { enabled: false, name },
    where: { name },
  });
  return flag.enabled;
};
const setFlag = async (name: string, enabled: boolean): Promise<boolean> => {
  const [flag] = await FeatureFlag.findOrCreate({
    defaults: { enabled, name },
    where: { name },
  });
  if (flag.enabled !== enabled) {
    await flag.update({ enabled });
  }
  return enabled;
};
export const leaderboardsEnabled = (): Promise<boolean> =>
  getFlag(LEADERBOARDS_FLAG);
export const automaticLeaderboardCheckinsEnabled = async (): Promise<boolean> =>
  (await leaderboardsEnabled()) && getFlag(AUTOMATIC_CHECKINS_FLAG);
export const setLeaderboardsEnabled = (enabled: boolean): Promise<boolean> =>
  setFlag(LEADERBOARDS_FLAG, enabled);
export const setAutomaticLeaderboardCheckinsEnabled = (
  enabled: boolean
): Promise<boolean> => setFlag(AUTOMATIC_CHECKINS_FLAG, enabled);
export const getLeaderboardFlags = async (): Promise<{
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
}> => ({
  automaticLeaderboardCheckinsEnabled:
    await automaticLeaderboardCheckinsEnabled(),
  leaderboardsEnabled: await leaderboardsEnabled(),
});
