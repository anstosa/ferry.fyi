import React, { FunctionComponent, useEffect, useRef, useState } from "react";
import type { Vessel } from "shared/contracts/vessels";

import {
  ForegroundLocation,
  Point,
  requestForegroundLocation,
} from "~/lib/geo";
import {
  canWatchLeaderboardForegroundCheckins,
  isDefinitelyInsideTerminal,
  isDefinitelyNearVessel,
  isDefinitelyOutsideTerminal,
  shouldContinueForegroundLocationPolling,
  vesselSailingId,
} from "~/lib/leaderboardForeground";

const POLL_INTERVAL_MS = 30_000;

export interface LeaderboardTerminal {
  id: string;
  location: Point;
  name: string;
}

interface NearbyTerminal {
  id: string;
  name: string;
  type: "terminal" | "vessel";
}

interface WatcherProps {
  isAuthenticated: boolean;
  isEnrolled: boolean;
  isOptedOut?: boolean;
  onEnterTerminal: (
    terminal: LeaderboardTerminal,
    location: ForegroundLocation
  ) => Promise<void>;
  onLeaveTerminal: (
    terminal: LeaderboardTerminal,
    location: ForegroundLocation
  ) => Promise<void>;
  onEnterVessel?: (
    vessel: Vessel,
    location: ForegroundLocation,
    sailingId: string
  ) => Promise<void>;
  terminals: LeaderboardTerminal[];
  vessels?: Vessel[];
}

/**
 * Foreground-only location loop for the leaderboard page. It deliberately
 * bypasses useGeo so it cannot read the global/shared location cache. Fixes
 * exist only inside the current async iteration and are dropped on hide or
 * unmount before any server request can use them.
 */
export const LeaderboardForegroundCheckinWatcher: FunctionComponent<
  WatcherProps
> = ({
  isAuthenticated,
  isEnrolled,
  isOptedOut = false,
  onEnterTerminal,
  onEnterVessel,
  onLeaveTerminal,
  terminals,
  vessels = [],
}) => {
  const latest = useRef({
    onEnterTerminal,
    onEnterVessel,
    onLeaveTerminal,
    terminals,
    vessels,
  });
  latest.current = {
    onEnterTerminal,
    onEnterVessel,
    onLeaveTerminal,
    terminals,
    vessels,
  };
  const activeTerminals = useRef(new Set<string>());
  const promptedTerminals = useRef(new Set<string>());
  const attemptedSailings = useRef(new Set<string>());
  const watcherGeneration = useRef(0);
  const [nearby, setNearby] = useState<NearbyTerminal | null>(null);

  useEffect(() => {
    if (
      !canWatchLeaderboardForegroundCheckins(
        isAuthenticated,
        isEnrolled,
        isOptedOut
      )
    ) {
      activeTerminals.current.clear();
      promptedTerminals.current.clear();
      attemptedSailings.current.clear();
      setNearby(null);
      return;
    }

    const generation = ++watcherGeneration.current;
    let active = true;
    let timeout: number | undefined;
    const isCurrent = (): boolean =>
      active &&
      generation === watcherGeneration.current &&
      document.visibilityState === "visible";
    const clearPrompt = (): void => {
      // Terminal identifiers are not location data. Keep the session's prompt
      // history and active membership across an app-open visibility pause.
      // A fresh visible fix must prove departures before any new entry.
      setNearby(null);
    };
    const schedule = (): void => {
      if (
        shouldContinueForegroundLocationPolling(
          isAuthenticated,
          isEnrolled,
          document.visibilityState === "visible",
          active,
          isOptedOut
        )
      ) {
        timeout = window.setTimeout(checkLocation, POLL_INTERVAL_MS);
      }
    };
    const checkLocation = async (): Promise<void> => {
      if (!isCurrent()) {
        return;
      }
      try {
        const location = await requestForegroundLocation();
        if (!isCurrent() || !location) {
          return;
        }

        const {
          onEnterTerminal,
          onEnterVessel,
          onLeaveTerminal,
          terminals,
          vessels,
        } = latest.current;
        const terminalById = new Map(
          terminals.map((terminal) => [terminal.id, terminal])
        );
        for (const terminalId of activeTerminals.current) {
          const terminal = terminalById.get(terminalId);
          if (
            terminal &&
            isDefinitelyOutsideTerminal(location, terminal.location)
          ) {
            activeTerminals.current.delete(terminalId);
            // Departures are sent before any new entry, so a terminal exit is
            // not lost when the app was briefly hidden. Never continue after
            // an opt-out/unmount invalidates this foreground iteration.
            await onLeaveTerminal(terminal, location).catch(() => undefined);
            if (!isCurrent()) {
              return;
            }
          }
        }

        const terminal = terminals.find((item) =>
          isDefinitelyInsideTerminal(location, item.location)
        );
        if (terminal && !activeTerminals.current.has(terminal.id)) {
          activeTerminals.current.add(terminal.id);
          if (!promptedTerminals.current.has(terminal.id)) {
            promptedTerminals.current.add(terminal.id);
            setNearby({
              id: terminal.id,
              name: terminal.name,
              type: "terminal",
            });
          }
          if (isCurrent()) {
            await onEnterTerminal(terminal, location).catch(() => undefined);
          }
        }

        const vessel = vessels.find((candidate) => {
          const sailingId = vesselSailingId(candidate);
          return (
            Boolean(sailingId) &&
            Boolean(candidate.location) &&
            !attemptedSailings.current.has(sailingId as string) &&
            isDefinitelyNearVessel(location, candidate.location as Point)
          );
        });
        const sailingId = vessel && vesselSailingId(vessel);
        if (vessel && sailingId && onEnterVessel) {
          attemptedSailings.current.add(sailingId);
          setNearby({ id: sailingId, name: vessel.name, type: "vessel" });
          if (isCurrent()) {
            await onEnterVessel(vessel, location, sailingId).catch(
              () => undefined
            );
          }
        }
      } finally {
        // A denied/unavailable fix is transient. Keep polling only while this
        // foreground page remains eligible; never leave a hidden-page timer.
        schedule();
      }
    };
    const handleVisibilityChange = (): void => {
      window.clearTimeout(timeout);
      if (document.visibilityState !== "visible") {
        clearPrompt();
        return;
      }
      checkLocation().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState === "visible") {
      checkLocation().catch(() => undefined);
    }
    return () => {
      active = false;
      watcherGeneration.current += 1;
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Drop session-only terminal membership only when the watcher becomes
      // ineligible or unmounts. Visibility pauses intentionally retain IDs.
      activeTerminals.current.clear();
      attemptedSailings.current.clear();
      setNearby(null);
    };
  }, [isAuthenticated, isEnrolled, isOptedOut]);

  if (!nearby) {
    return null;
  }
  return (
    <section className="mt-4 rounded-2xl border border-green-dark p-4">
      <h2 className="font-bold">You&apos;re near {nearby.name}</h2>
      <p className="mt-1 text-sm">
        Ferry FYI is open and is verifying your {nearby.type} check-in with this
        foreground location.
      </p>
      <button
        className="button mt-3"
        onClick={() => setNearby(null)}
        type="button"
      >
        Dismiss
      </button>
    </section>
  );
};
