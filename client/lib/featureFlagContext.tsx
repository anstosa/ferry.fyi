import { createContext } from "react";

export interface FeatureFlags {
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
  loading: boolean;
}

export const disabledFlags: FeatureFlags = {
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled: false,
  loading: false,
};

export const FeatureFlagContext = createContext<FeatureFlags>(disabledFlags);
