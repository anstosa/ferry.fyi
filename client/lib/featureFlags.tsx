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

// project only reviewed client feature decisions
function createFeatureFlags(
  leaderboardsEnabled: boolean,
  automaticLeaderboardCheckinsEnabled = false
): FeatureFlags {
  return {
    automaticLeaderboardCheckinsEnabled:
      leaderboardsEnabled && automaticLeaderboardCheckinsEnabled,
    leaderboardsEnabled,
    loading: false,
  };
}

// parse subject-aware flags without accepting extra client capabilities
function parseFlags(value: unknown, authenticated: boolean): FeatureFlags {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return createFeatureFlags(
    record.leaderboardsEnabled === true,
    authenticated && record.automaticLeaderboardCheckinsEnabled === true
  );
}

/** fetches public flags anonymously and private flags with the active subject token */
export const FeatureFlagProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();
  const seeded = usePublicSsrSource("features");
  const currentSubject = isAuthenticated ? (user?.sub ?? null) : null;
  // initialize one subject-bound flag snapshot
  const [resolved, setResolved] = useState<{
    flags: FeatureFlags;
    subject: string | null;
  }>(() => ({
    flags: seeded
      ? createFeatureFlags(seeded.leaderboardsEnabled)
      : disabledFlags,
    subject: currentSubject,
  }));
  const flags =
    resolved.subject === currentSubject ? resolved.flags : disabledFlags;

  useEffect(() => {
    let cancelled = false;
    const subject = currentSubject;
    const authenticated = subject !== null;
    // clear private decisions before loading another subject
    setResolved((current) =>
      current.subject === subject ? current : { flags: disabledFlags, subject }
    );
    // load one subject-bound flag snapshot
    const load = async (): Promise<void> => {
      try {
        const value = authenticated
          ? await get("/features/me", await getAccessTokenSilently())
          : await get("/features");
        // discard a stale subject response
        if (!cancelled) {
          setResolved({ flags: parseFlags(value, authenticated), subject });
        }
      } catch {
        // fail closed for the captured subject
        if (!cancelled) {
          setResolved({ flags: disabledFlags, subject });
        }
      }
    };
    load().catch(
      // absorb one fail-closed load result
      () => undefined
    );
    // invalidate the captured subject request
    return () => {
      cancelled = true;
    };
  }, [currentSubject, getAccessTokenSilently]);

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
