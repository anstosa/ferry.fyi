import { describe, expect, it } from "vitest";

import {
  anonymizedLeaderboardSubject,
  cooldownMilliseconds,
  distanceInMeters,
  evaluateTerminalEligibility,
  hasActiveTerminalCheckin,
  isDefinitelyInsideTerminalGeofence,
  isDefinitelyOutsideTerminalGeofence,
  isLocationAccurateEnough,
  leaderboardLabel,
  limitLeaderboardRanks,
  normalizeLeaderboardDisplayName,
  periodStart,
  stableSailingId,
  TERMINAL_GEOFENCE_METERS,
} from "../../server/lib/leaderboards";

describe("leaderboard eligibility helpers", () => {
  it("uses a 1,000 foot terminal geofence", () => {
    const terminal = { latitude: 47.6025, longitude: -122.3382 };
    expect(isDefinitelyInsideTerminalGeofence(terminal, terminal, 10)).toBe(
      true
    );
    expect(isDefinitelyOutsideTerminalGeofence(terminal, terminal, 10)).toBe(
      false
    );
    expect(TERMINAL_GEOFENCE_METERS).toBe(304.8);
    expect(
      distanceInMeters(terminal, { latitude: 47.607, longitude: -122.3382 })
    ).toBeGreaterThan(TERMINAL_GEOFENCE_METERS);
  });

  it("requires usable foreground accuracy and doubles the shortest crossing time", () => {
    expect(isLocationAccurateEnough(100)).toBe(true);
    expect(isLocationAccurateEnough(100.01)).toBe(false);
    expect(cooldownMilliseconds(20)).toBe(40 * 60_000);
  });

  it("requires a recorded exit, then honors cooldown before re-entry", () => {
    const creditedAt = new Date("2026-07-20T10:00:00.000Z");
    const beforeExit = evaluateTerminalEligibility(
      { exitedAt: null, lastCreditedAt: creditedAt },
      new Date("2026-07-20T10:01:00.000Z"),
      20
    );
    expect(beforeExit).toMatchObject({
      eligible: false,
      reason: "MUST_LEAVE_TERMINAL",
    });

    const duringCooldown = evaluateTerminalEligibility(
      {
        exitedAt: new Date("2026-07-20T10:02:00.000Z"),
        lastCreditedAt: creditedAt,
      },
      new Date("2026-07-20T10:30:00.000Z"),
      20
    );
    expect(duringCooldown).toMatchObject({
      eligible: false,
      reason: "COOLDOWN",
    });

    expect(
      evaluateTerminalEligibility(
        {
          exitedAt: new Date("2026-07-20T10:02:00.000Z"),
          lastCreditedAt: creditedAt,
        },
        new Date("2026-07-20T10:41:00.000Z"),
        20
      )
    ).toEqual({ eligible: true });
  });

  it("keeps a terminal checked in until a verified departure is recorded", () => {
    const creditedAt = new Date("2026-07-20T10:00:00.000Z");
    expect(
      hasActiveTerminalCheckin({ exitedAt: null, lastCreditedAt: creditedAt })
    ).toBe(true);
    expect(
      hasActiveTerminalCheckin({
        exitedAt: new Date("2026-07-20T10:01:00.000Z"),
        lastCreditedAt: creditedAt,
      })
    ).toBe(false);
  });

  it("calculates Monday-start weeks in Pacific time", () => {
    const start = periodStart("week", new Date("2026-07-23T20:00:00Z"));
    expect(start?.toISOString()).toBe("2026-07-20T07:00:00.000Z");
  });

  it("irreversibly replaces deleted-account identifiers", () => {
    const anonymized = anonymizedLeaderboardSubject();
    expect(anonymized).toMatch(/^deleted:[0-9a-f-]{36}$/);
    expect(anonymized).not.toContain("auth0|user");
  });

  it("normalizes safe display names and rejects unsafe values", () => {
    expect(normalizeLeaderboardDisplayName("  Ada   Lovelace ")).toBe(
      "Ada Lovelace"
    );
    expect(normalizeLeaderboardDisplayName("\u0000Ada")).toBeNull();
    expect(normalizeLeaderboardDisplayName("   ")).toBeNull();
    expect(normalizeLeaderboardDisplayName("a".repeat(81))).toBeNull();
    expect(normalizeLeaderboardDisplayName("Admin")).toBeNull();
    expect(normalizeLeaderboardDisplayName("f3rry fyi")).toBeNull();
    expect(normalizeLeaderboardDisplayName("Ada Fuck Lovelace")).toBeNull();
    expect(normalizeLeaderboardDisplayName("Scunthorpe")).toBe("Scunthorpe");
    expect(normalizeLeaderboardDisplayName("ＡＬ")).toBe("ＡＬ");
    expect(normalizeLeaderboardDisplayName("Ada\u200e Lovelace")).toBeNull();
    expect(normalizeLeaderboardDisplayName("AL")).toBe("AL");
  });

  it("limits public leaderboards to the top ten eligible ranks", () => {
    expect(
      limitLeaderboardRanks(Array.from({ length: 12 }, (_, index) => index))
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("uses the moderated display name as the public label", () => {
    expect(leaderboardLabel(" Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(leaderboardLabel("AL")).toBe("AL");
    expect(leaderboardLabel("")).toBe("Anonymous");
  });

  // verify live sailing requirements
  it("accepts only fresh underway WSF sailing identities", () => {
    const nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const nowSeconds = nowMs / 1000;
    const vessel = {
      arrivingTerminalId: 2,
      departedTime: nowSeconds - 60,
      departingTerminalId: 1,
      id: "42",
      inService: true,
      isAtDock: false,
      location: { latitude: 47.6, longitude: -122.4 },
      statusUpdatedAt: nowMs - 60_000,
    };
    expect(stableSailingId(vessel, nowMs)).toBe(`42:${nowSeconds - 60}:1:2`);
    expect(
      stableSailingId({ ...vessel, statusUpdatedAt: nowMs - 6 * 60_000 }, nowMs)
    ).toBeNull();
    expect(stableSailingId({ ...vessel, isAtDock: true }, nowMs)).toBeNull();
  });

  // verify unit boundaries
  it("keeps WSF departure freshness boundaries in epoch seconds", () => {
    const nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const nowSeconds = nowMs / 1000;
    const vessel = {
      arrivingTerminalId: 2,
      departedTime: nowSeconds,
      departingTerminalId: 1,
      id: "42",
      inService: true,
      isAtDock: false,
      location: { latitude: 47.6, longitude: -122.4 },
      statusUpdatedAt: nowMs,
    };

    expect(
      stableSailingId(
        { ...vessel, departedTime: nowSeconds - 12 * 60 * 60 },
        nowMs
      )
    ).not.toBeNull();
    expect(
      stableSailingId(
        { ...vessel, departedTime: nowSeconds - 12 * 60 * 60 - 1 },
        nowMs
      )
    ).toBeNull();
    expect(
      stableSailingId({ ...vessel, departedTime: nowSeconds + 60 }, nowMs)
    ).not.toBeNull();
    expect(
      stableSailingId({ ...vessel, departedTime: nowSeconds + 61 }, nowMs)
    ).toBeNull();
    expect(stableSailingId({ ...vessel, departedTime: 0 }, nowMs)).toBeNull();
    expect(
      stableSailingId({ ...vessel, departedTime: Number.NaN }, nowMs)
    ).toBeNull();
    expect(
      stableSailingId({ ...vessel, departedTime: nowMs - 60_000 }, nowMs)
    ).toBeNull();
    expect(
      stableSailingId({ ...vessel, statusUpdatedAt: nowSeconds }, nowMs)
    ).toBeNull();
  });
});
