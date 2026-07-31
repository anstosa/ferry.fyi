import { useAuth0 } from "@auth0/auth0-react";
import React, {
  FunctionComponent,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

import { get } from "~/lib/api";
import {
  disabledFlags,
  FeatureFlagContext,
  type FeatureFlags,
} from "~/lib/featureFlagContext";
import { useAppRenderContext } from "~/lib/renderContext";
import { usePublicSsrSource } from "~/lib/ssrSeed";

export { FeatureFlagContext } from "~/lib/featureFlagContext";

function createFeatureFlags(leaderboardsEnabled: boolean): FeatureFlags {
  return {
    // Automatic/background check-ins are permanently unavailable for this launch.
    automaticLeaderboardCheckinsEnabled: false,
    leaderboardsEnabled,
    loading: false,
  };
}

function parseFlags(value: unknown): FeatureFlags {
  return createFeatureFlags(
    typeof value === "object" &&
      value !== null &&
      "leaderboardsEnabled" in value &&
      (value as { leaderboardsEnabled?: unknown }).leaderboardsEnabled === true
  );
}

/** Fetches public flags anonymously and private flags with the active subject token. */
export const FeatureFlagProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [flags, setFlags] = useState<FeatureFlags>(disabledFlags);

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

export const useFeatureFlags = (): FeatureFlags => {
  const seeded = usePublicSsrSource("features");
  const flags = useContext(FeatureFlagContext);
  const { runtime } = useAppRenderContext();
  return seeded && runtime !== "browser"
    ? createFeatureFlags(seeded.leaderboardsEnabled)
    : flags;
};
