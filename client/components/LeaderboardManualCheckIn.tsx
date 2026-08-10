import { useAuth0 } from "@auth0/auth0-react";
import React, { ReactElement, useCallback, useEffect, useState } from "react";

import { loginWithAppFlow } from "~/lib/auth";
import { requestForegroundLocation } from "~/lib/geo";
import { vesselSailingId } from "~/lib/leaderboardForeground";
import { notifyLeaderboardCheckIn } from "~/lib/leaderboardNotifications";
import {
  getLeaderboardPreferences,
  getTerminalCheckInStatus,
  getVesselCheckInStatus,
  submitTerminalCheckIn,
  submitVesselCheckIn,
} from "~/lib/leaderboards";
import { getVessels } from "~/lib/vessels";
import CheckIcon from "~/static/images/icons/solid/check-circle.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";

type CheckInKind = "terminal" | "vessel";

interface Props {
  entityId: string;
  kind: CheckInKind;
  name: string;
}

const reasonText = (reason?: string): string => {
  switch (reason) {
    case "COOLDOWN":
      return "You can check in here again after the terminal cooldown ends.";
    case "LOCATION_ACCURACY_TOO_LOW":
    case "LOCATION_UNCERTAIN":
      return "Your location is not accurate enough to verify this check-in.";
    case "MUST_LEAVE_TERMINAL":
      return "Leave the terminal geofence before checking in here again.";
    case "NOT_NEAR_LIVE_VESSEL":
      return "You are not close enough to this live vessel to check in.";
    case "OUTSIDE_GEOFENCE":
      return "You are outside this terminal's check-in area.";
    case "SAILING_ALREADY_CREDITED":
      return "You are already checked in for this sailing.";
    case "TOO_CLOSE_TO_SHORE":
      return "This vessel must be farther from shore before check-in.";
    case "UNKNOWN_OR_UNSTABLE_SAILING":
      return "This vessel is not on a verifiable sailing right now.";
    default:
      return "This check-in could not be verified right now. Try again shortly.";
  }
};

/**
 * An explicit check-in action that requests one fresh foreground fix and
 * delegates every eligibility decision to the server. The location is never
 * placed in state or local storage.
 */
export const LeaderboardManualCheckIn = ({
  entityId,
  kind,
  name,
}: Props): ReactElement => {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    loginWithPopup,
    loginWithRedirect,
  } = useAuth0();
  const [checkedIn, setCheckedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setChecking] = useState(false);

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setCheckedIn(false);
      return;
    }
    const accessToken = await getAccessTokenSilently();
    const status =
      kind === "terminal"
        ? await getTerminalCheckInStatus(entityId, accessToken)
        : await getVesselCheckInStatus(entityId, accessToken);
    setCheckedIn(status.checkedIn);
  }, [entityId, getAccessTokenSilently, isAuthenticated, kind]);

  useEffect(() => {
    refreshStatus().catch(() => setCheckedIn(false));
  }, [refreshStatus]);

  useEffect(() => {
    const updateStatus = (event: Event): void => {
      const { detail } = event as CustomEvent<{
        entityId: string;
        kind: CheckInKind;
      }>;
      if (detail?.entityId === entityId && detail.kind === kind) {
        setCheckedIn(true);
        setError(null);
      }
    };
    window.addEventListener("leaderboard-checkin-credited", updateStatus);
    return () =>
      window.removeEventListener("leaderboard-checkin-credited", updateStatus);
  }, [entityId, kind]);

  const checkIn = async (): Promise<void> => {
    if (!isAuthenticated) {
      await loginWithAppFlow({
        loginWithPopup,
        loginWithRedirect,
        options: {
          appState: {
            redirectPath: `${window.location.pathname}${window.location.search}`,
          },
        },
      });
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const location = await requestForegroundLocation();
      if (!location) {
        setError("A fresh location is required to verify this check-in.");
        return;
      }
      const accessToken = await getAccessTokenSilently();
      if (kind === "terminal") {
        const result = await submitTerminalCheckIn(
          { ...location, terminalId: entityId },
          accessToken
        );
        if (!result.credited) {
          setError(reasonText(result.reason));
          return;
        }
      } else {
        const vessel = (await getVessels({ force: true })).find(
          ({ id }) => id === entityId
        );
        const sailingId = vessel ? vesselSailingId(vessel) : null;
        if (!sailingId) {
          setError(reasonText("UNKNOWN_OR_UNSTABLE_SAILING"));
          return;
        }
        const result = await submitVesselCheckIn(
          { ...location, sailingId, vesselId: entityId },
          accessToken
        );
        if (!result.credited && result.reason !== "SAILING_ALREADY_CREDITED") {
          setError(reasonText(result.reason));
          return;
        }
      }
      setCheckedIn(true);
      getLeaderboardPreferences(accessToken)
        .then((preferences) => {
          if (preferences.notificationsEnabled) {
            return notifyLeaderboardCheckIn(name, false);
          }
          return undefined;
        })
        .catch(() => undefined);
      window.dispatchEvent(
        new CustomEvent("leaderboard-checkin-credited", {
          detail: { entityId, kind },
        })
      );
    } catch {
      setError(
        "This check-in could not be verified right now. Try again shortly."
      );
    } finally {
      setChecking(false);
    }
  };

  if (checkedIn) {
    return (
      <section className="mt-4 flex items-center gap-3 rounded-2xl border border-green-dark bg-green-lightest p-4 text-green-dark dark:border-green-light dark:bg-green-dark/30 dark:text-green-light">
        <CheckIcon className="h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-bold">You&apos;re checked in</h2>
          <p className="mt-0.5 text-sm">Your {kind} check-in is verified.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-gray-light bg-white p-4 dark:border-gray-dark dark:bg-blue-dark">
      <h2 className="font-bold">
        Check in {kind === "vessel" ? "on" : "at"} {name}
      </h2>
      <button
        className="button button-primary mt-2"
        disabled={isChecking}
        onClick={() => checkIn()}
        type="button"
      >
        <LocationIcon className="button-icon" />
        {isChecking ? "Checking compliance…" : "Check in"}
      </button>
      {error && (
        <p
          className="mt-2 text-sm text-stale-dark dark:text-stale-light"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
};
