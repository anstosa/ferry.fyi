import { useAuth0 } from "@auth0/auth0-react";
import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LeaderboardPreferences } from "shared/contracts/leaderboards";
import type { Vessel } from "shared/contracts/vessels";

import {
  LeaderboardForegroundCheckinWatcher,
  LeaderboardTerminal,
} from "~/components/LeaderboardForegroundCheckinWatcher";
import { useFeatureFlags } from "~/lib/featureFlags";
import type { ForegroundLocation } from "~/lib/geo";
import {
  initialLeaderboardLocationEnrollmentState,
  LEADERBOARD_LOCATION_ENROLLMENT_CHANGED,
  LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY,
  LeaderboardLocationEnrollmentState,
  parseLeaderboardLocationEnrollmentState,
} from "~/lib/leaderboardLocation";
import { notifyLeaderboardCheckIn } from "~/lib/leaderboardNotifications";
import {
  getLeaderboardPreferences,
  submitTerminalCheckIn,
  submitTerminalDeparture,
  submitVesselCheckIn,
} from "~/lib/leaderboards";
import { useTerminalList } from "~/lib/terminals";

import { useLiveVessels } from "../lib/vessels";

const initialEnrollment = (): LeaderboardLocationEnrollmentState => {
  try {
    return parseLeaderboardLocationEnrollmentState(
      JSON.parse(
        window.localStorage.getItem(
          LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY
        ) ?? "null"
      )
    );
  } catch {
    return initialLeaderboardLocationEnrollmentState;
  }
};

/**
 * Keeps terminal check-ins active anywhere in the visible app after the user
 * has explicitly enrolled. It never mounts a watcher for a hidden app, an
 * unsigned-in account, or an opted-out profile.
 */
export const LeaderboardForegroundCheckins: FunctionComponent = () => {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  // Do not use useTerminals here: it reads the shared useGeo cache and could
  // acquire location before this foreground-only watcher has explicit consent.
  const terminals = useTerminalList();
  const { leaderboardsEnabled } = useFeatureFlags();
  // Foreground automation is deliberately not part of the manual-only launch.
  // These explicit constants protect this client even if an old API response
  // still contains the retired automatic-check-ins flag.
  const terminalCheckinsEnabled = false;
  const vesselCheckinsEnabled = false;
  const vessels = useLiveVessels(vesselCheckinsEnabled, 60_000);
  const [enrollment, setEnrollment] = useState(initialEnrollment);
  const [preferences, setPreferences] = useState<LeaderboardPreferences | null>(
    null
  );
  const preferencesRef = useRef<LeaderboardPreferences | null>(null);
  // Each refresh captures this version. Local preference changes invalidate
  // outstanding reads so an older server response cannot undo an optimistic
  // opt-out while its save request is still pending.
  const preferenceRequestVersion = useRef(0);
  const checkinGeneration = useRef(0);

  // Kept as a defensive guard for callbacks that may outlive a render.
  const isCurrentCheckinGeneration: (generation: number) => boolean =
    useCallback((): boolean => false, []);

  useEffect(() => {
    const updateEnrollment = (event: Event): void => {
      const next = (event as CustomEvent<LeaderboardLocationEnrollmentState>)
        .detail;
      setEnrollment(parseLeaderboardLocationEnrollmentState(next));
    };
    window.addEventListener(
      LEADERBOARD_LOCATION_ENROLLMENT_CHANGED,
      updateEnrollment
    );
    return () =>
      window.removeEventListener(
        LEADERBOARD_LOCATION_ENROLLMENT_CHANGED,
        updateEnrollment
      );
  }, []);

  const refreshPreferences = useCallback(async (): Promise<void> => {
    const requestVersion = preferenceRequestVersion.current + 1;
    preferenceRequestVersion.current = requestVersion;
    if (!isAuthenticated || !leaderboardsEnabled) {
      setPreferences(null);
      return;
    }
    try {
      const next = await getLeaderboardPreferences(
        await getAccessTokenSilently()
      );
      if (requestVersion === preferenceRequestVersion.current) {
        setPreferences(next);
      }
    } catch {
      // A future foreground iteration can retry. Never use stale opt-out data.
      if (requestVersion === preferenceRequestVersion.current) {
        setPreferences(null);
      }
    }
  }, [getAccessTokenSilently, isAuthenticated]);

  useEffect(() => {
    const handlePreferencesChange = (event: Event): void => {
      // A preference event is an optimistic local source of truth. Invalidate
      // every prior fetch before applying it or starting a replacement read.
      preferenceRequestVersion.current += 1;
      const next = (event as CustomEvent<LeaderboardPreferences>).detail;
      if (next) {
        // Opt-out takes effect locally before the save request settles, so no
        // new foreground fix can be requested during the transition. Requests
        // already in flight cannot be recalled, but their result is ignored.
        preferencesRef.current = next;
        if (next.optedOut) {
          checkinGeneration.current += 1;
        }
        setPreferences(next);
        return;
      }
      refreshPreferences().catch(() => undefined);
    };
    refreshPreferences().catch(() => undefined);
    window.addEventListener(
      "leaderboard-preferences-changed",
      handlePreferencesChange
    );
    return () =>
      window.removeEventListener(
        "leaderboard-preferences-changed",
        handlePreferencesChange
      );
  }, [refreshPreferences]);

  useEffect(() => {
    preferencesRef.current = preferences;
    if (
      !isAuthenticated ||
      enrollment.enrollment !== "enrolled" ||
      preferences?.optedOut !== false ||
      !preferences.automaticCheckinsEnabled
    ) {
      checkinGeneration.current += 1;
    }
  }, [enrollment.enrollment, isAuthenticated, preferences]);

  const checkIn = useCallback(
    async (
      terminal: LeaderboardTerminal,
      location: ForegroundLocation
    ): Promise<void> => {
      const generation = checkinGeneration.current;
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      const accessToken = await getAccessTokenSilently();
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      const result = await submitTerminalCheckIn(
        { ...location, terminalId: terminal.id },
        accessToken
      );
      if (isCurrentCheckinGeneration(generation) && result.credited) {
        window.dispatchEvent(
          new CustomEvent("leaderboard-checkin-credited", {
            detail: { entityId: terminal.id, kind: "terminal" },
          })
        );
      }
      if (
        isCurrentCheckinGeneration(generation) &&
        result.credited &&
        result.notification?.action === "replace" &&
        preferencesRef.current?.notificationsEnabled
      ) {
        // show the credited terminal
        await notifyLeaderboardCheckIn(terminal.name, { kind: "terminal" });
      }
    },
    [getAccessTokenSilently, isCurrentCheckinGeneration]
  );
  const recordDeparture = useCallback(
    async (
      terminal: LeaderboardTerminal,
      location: ForegroundLocation
    ): Promise<void> => {
      const generation = checkinGeneration.current;
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      const accessToken = await getAccessTokenSilently();
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      await submitTerminalDeparture(
        { ...location, terminalId: terminal.id },
        accessToken
      );
    },
    [getAccessTokenSilently, isCurrentCheckinGeneration]
  );

  const checkInToVessel = useCallback(
    async (
      vessel: Vessel,
      location: ForegroundLocation,
      sailingId: string
    ): Promise<void> => {
      const generation = checkinGeneration.current;
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      const accessToken = await getAccessTokenSilently();
      if (!isCurrentCheckinGeneration(generation)) {
        return;
      }
      const result = await submitVesselCheckIn(
        { ...location, sailingId, vesselId: vessel.id },
        accessToken
      );
      if (isCurrentCheckinGeneration(generation) && result.credited) {
        window.dispatchEvent(
          new CustomEvent("leaderboard-checkin-credited", {
            detail: { entityId: vessel.id, kind: "vessel" },
          })
        );
      }
    },
    [getAccessTokenSilently, isCurrentCheckinGeneration]
  );

  if (!terminalCheckinsEnabled && !vesselCheckinsEnabled) {
    return null;
  }
  return (
    <LeaderboardForegroundCheckinWatcher
      isAuthenticated={isAuthenticated}
      isEnrolled={enrollment.enrollment === "enrolled"}
      isOptedOut={
        preferences?.optedOut !== false ||
        !preferences?.automaticCheckinsEnabled
      }
      onEnterTerminal={checkIn}
      onEnterVessel={vesselCheckinsEnabled ? checkInToVessel : undefined}
      onLeaveTerminal={recordDeparture}
      terminals={terminalCheckinsEnabled ? terminals : []}
      vessels={vessels}
    />
  );
};
