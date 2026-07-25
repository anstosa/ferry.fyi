import { describe, expect, it } from "vitest";

import {
  canWatchLeaderboardForegroundCheckins,
  isDefinitelyInsideTerminal,
  isDefinitelyNearVessel,
  isDefinitelyOutsideTerminal,
  shouldContinueForegroundLocationPolling,
  vesselSailingId,
} from "../../client/lib/leaderboardForeground";

const terminal = { latitude: 47.6, longitude: -122.3 };

describe("leaderboard foreground terminal evidence", () => {
  it("does not start a location watcher until both sign-in and consent exist", () => {
    expect(canWatchLeaderboardForegroundCheckins(false, true)).toBe(false);
    expect(canWatchLeaderboardForegroundCheckins(true, false)).toBe(false);
    expect(canWatchLeaderboardForegroundCheckins(true, true)).toBe(true);
    expect(canWatchLeaderboardForegroundCheckins(true, true, true)).toBe(false);
  });

  it("retries an unavailable foreground fix only while the page stays eligible", () => {
    expect(
      shouldContinueForegroundLocationPolling(true, true, true, true)
    ).toBe(true);
    expect(
      shouldContinueForegroundLocationPolling(true, true, false, true)
    ).toBe(false);
    expect(
      shouldContinueForegroundLocationPolling(true, true, true, false)
    ).toBe(false);
    expect(
      shouldContinueForegroundLocationPolling(false, true, true, true)
    ).toBe(false);
    expect(
      shouldContinueForegroundLocationPolling(true, true, true, true, true)
    ).toBe(false);
  });

  it("only accepts a fix whose accuracy circle is inside the 1,000 foot fence", () => {
    expect(
      isDefinitelyInsideTerminal(
        { ...terminal, accuracyMeters: 20, observedAt: "2026-07-23T00:00:00Z" },
        terminal
      )
    ).toBe(true);
    expect(
      isDefinitelyInsideTerminal(
        {
          accuracyMeters: 30,
          latitude: 47.6027,
          longitude: -122.3,
          observedAt: "2026-07-23T00:00:00Z",
        },
        terminal
      )
    ).toBe(false);
  });

  it("only marks a departure after the entire accuracy circle leaves the fence", () => {
    expect(
      isDefinitelyOutsideTerminal(
        {
          accuracyMeters: 20,
          latitude: 47.6035,
          longitude: -122.3,
          observedAt: "2026-07-23T00:00:00Z",
        },
        terminal
      )
    ).toBe(true);
    expect(
      isDefinitelyOutsideTerminal(
        {
          accuracyMeters: 50,
          latitude: 47.6027,
          longitude: -122.3,
          observedAt: "2026-07-23T00:00:00Z",
        },
        terminal
      )
    ).toBe(false);
  });

  it("requires a fully nearby live vessel and a stable public sailing identity", () => {
    const vessel = {
      arrivingTerminalId: 2,
      departedTime: 1_785_000_000_000,
      departingTerminalId: 1,
      id: "42",
      inService: true,
      isAtDock: false,
      location: terminal,
    } as Parameters<typeof vesselSailingId>[0];
    expect(vesselSailingId(vessel)).toBe("42:1785000000000:1:2");
    expect(
      isDefinitelyNearVessel(
        { ...terminal, accuracyMeters: 20, observedAt: "2026-07-23T00:00:00Z" },
        terminal
      )
    ).toBe(true);
    expect(
      isDefinitelyNearVessel(
        {
          accuracyMeters: 30,
          latitude: 47.6022,
          longitude: -122.3,
          observedAt: "2026-07-23T00:00:00Z",
        },
        terminal
      )
    ).toBe(false);
    expect(vesselSailingId({ ...vessel, isAtDock: true })).toBeNull();
  });
});
