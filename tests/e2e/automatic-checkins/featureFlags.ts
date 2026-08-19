import { automaticFixtureState } from "./state";

// expose one subject-authorized feature projection
export const useFeatureFlags = () => ({
  automaticLeaderboardCheckinsEnabled: automaticFixtureState.featureEnabled,
  leaderboardsEnabled: true,
  loading: false,
});
