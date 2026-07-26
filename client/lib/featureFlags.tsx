import { useAuth0 } from "@auth0/auth0-react";
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

const disabledFlags: FeatureFlags = {
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled: false,
  loading: false,
};

const FeatureFlagContext = createContext<FeatureFlags>({
  ...disabledFlags,
  loading: true,
});

const parseFlags = (value: unknown): FeatureFlags => ({
  // Automatic/background check-ins are permanently unavailable for this launch.
  automaticLeaderboardCheckinsEnabled: false,
  leaderboardsEnabled:
    typeof value === "object" &&
    value !== null &&
    "leaderboardsEnabled" in value &&
    (value as { leaderboardsEnabled?: unknown }).leaderboardsEnabled === true,
  loading: false,
});

/** Fetches public flags anonymously and private flags with the active subject token. */
export const FeatureFlagProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [flags, setFlags] = useState<FeatureFlags>({
    ...disabledFlags,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const value = isAuthenticated
          ? await get("/features/me", await getAccessTokenSilently())
          : await get("/features");
        if (!cancelled) {
          setFlags(parseFlags(value));
        }
      } catch {
        if (!cancelled) {
          setFlags(disabledFlags);
        }
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [getAccessTokenSilently, isAuthenticated]);

  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

export const useFeatureFlags = (): FeatureFlags =>
  useContext(FeatureFlagContext);
