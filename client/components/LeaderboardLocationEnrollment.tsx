import React, { FunctionComponent, useState } from "react";

import { useLocalStorage } from "~/lib/browser";
import {
  initialLeaderboardLocationEnrollmentState,
  LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY,
  LeaderboardLocationEnrollmentState,
  notifyLeaderboardEnrollmentChanged,
  parseLeaderboardLocationEnrollmentState,
  requestLeaderboardLocationAccess,
  requestLeaderboardNotificationAccess,
} from "~/lib/leaderboardLocation";
import LocationIcon from "~/static/images/icons/solid/location.svg";

/**
 * Feature-gated, foreground-only consent walkthrough. It records only local
 * permission outcomes; location is requested after a tap and immediately discarded.
 */
export const LeaderboardLocationEnrollment: FunctionComponent<{
  onEnrollmentChange?: (isEnrolled: boolean) => void;
}> = ({ onEnrollmentChange }) => {
  const [storedState, saveState] =
    useLocalStorage<LeaderboardLocationEnrollmentState>(
      LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY,
      initialLeaderboardLocationEnrollmentState
    );
  const state = parseLeaderboardLocationEnrollmentState(storedState);
  const [isRequestingLocation, setRequestingLocation] = useState(false);
  const [isRequestingNotifications, setRequestingNotifications] =
    useState(false);

  const requestLocation = async (): Promise<void> => {
    setRequestingLocation(true);
    try {
      const locationAccess = await requestLeaderboardLocationAccess();
      const isEnrolled = locationAccess === "granted";
      const nextState: LeaderboardLocationEnrollmentState = {
        ...state,
        enrollment: isEnrolled ? "enrolled" : "unprompted",
        locationAccess,
      };
      saveState(nextState);
      notifyLeaderboardEnrollmentChanged(nextState);
      onEnrollmentChange?.(isEnrolled);
    } finally {
      setRequestingLocation(false);
    }
  };

  const requestNotifications = async (): Promise<void> => {
    setRequestingNotifications(true);
    try {
      const notificationAccess = await requestLeaderboardNotificationAccess();
      const nextState = { ...state, notificationAccess };
      saveState(nextState);
      notifyLeaderboardEnrollmentChanged(nextState);
    } finally {
      setRequestingNotifications(false);
    }
  };

  if (state.enrollment === "declined") {
    return null;
  }

  if (state.enrollment !== "enrolled") {
    return (
      <section className="rounded-2xl border border-gray-light p-4 dark:border-gray-dark">
        <div className="flex items-start gap-3">
          <LocationIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-dark" />
          <div>
            <h2 className="font-bold">Check in at terminals?</h2>
            <p className="mt-1 text-sm leading-relaxed">
              Location is used only while this page is open to verify a terminal
              check-in. Ferry FYI does not track you in the background or store
              your coordinates.
            </p>
            {state.locationAccess === "unavailable" && (
              <p className="mt-2 text-sm text-stale-dark dark:text-stale-light">
                Location was unavailable. You can enable it in device settings
                and try again.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="button button-primary"
                disabled={isRequestingLocation}
                onClick={() => requestLocation()}
                type="button"
              >
                {isRequestingLocation ? "Requesting location…" : "Continue"}
              </button>
              <button
                className="button"
                disabled={isRequestingLocation}
                onClick={() => {
                  const nextState = {
                    ...state,
                    enrollment: "declined" as const,
                  };
                  saveState(nextState);
                  notifyLeaderboardEnrollmentChanged(nextState);
                }}
                type="button"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (state.notificationAccess === "unknown") {
    return (
      <section className="rounded-2xl border border-gray-light p-4 dark:border-gray-dark">
        <h2 className="font-bold">Check-in notifications</h2>
        <p className="mt-1 text-sm leading-relaxed">
          Notifications are on by default for credited check-ins. You can change
          this anytime in leaderboard settings; check-ins still work when they
          are off.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="button button-primary"
            disabled={isRequestingNotifications}
            onClick={() => requestNotifications()}
            type="button"
          >
            {isRequestingNotifications
              ? "Requesting notifications…"
              : "Allow notifications"}
          </button>
          <button
            className="button"
            disabled={isRequestingNotifications}
            onClick={() => {
              const nextState = {
                ...state,
                notificationAccess: "unavailable" as const,
              };
              saveState(nextState);
              notifyLeaderboardEnrollmentChanged(nextState);
            }}
            type="button"
          >
            Skip
          </button>
        </div>
      </section>
    );
  }

  return null;
};
