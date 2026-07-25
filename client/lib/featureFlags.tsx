import React, {
  createContext,
  FunctionComponent,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

import { get } from "~/lib/api";

interface FeatureFlags {
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
  loading: boolean;
}

const FeatureFlagContext = createContext<FeatureFlags>({
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled: false,
  loading: true,
});

export const FeatureFlagProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const [flags, setFlags] = useState<FeatureFlags>({
    automaticLeaderboardCheckinsEnabled: false,
    leaderboardsEnabled: false,
    loading: true,
  });
  useEffect(() => {
    get("/features")
      .then((value: unknown) => {
        const leaderboardsEnabled =
          typeof value === "object" &&
          value !== null &&
          "leaderboardsEnabled" in value &&
          (value as { leaderboardsEnabled?: unknown }).leaderboardsEnabled ===
            true;
        const automaticLeaderboardCheckinsEnabled =
          typeof value === "object" &&
          value !== null &&
          "automaticLeaderboardCheckinsEnabled" in value &&
          (value as { automaticLeaderboardCheckinsEnabled?: unknown })
            .automaticLeaderboardCheckinsEnabled === true;
        setFlags({
          automaticLeaderboardCheckinsEnabled,
          leaderboardsEnabled,
          loading: false,
        });
      })
      .catch(() =>
        setFlags({
          automaticLeaderboardCheckinsEnabled: false,
          leaderboardsEnabled: false,
          loading: false,
        })
      );
  }, []);
  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

export const useFeatureFlags = (): FeatureFlags =>
  useContext(FeatureFlagContext);
