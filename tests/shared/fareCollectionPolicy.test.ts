import { describe, expect, it } from "vitest";

import {
  FARE_COLLECTION_POLICY,
  FARE_POLICY_REVIEWED_AT,
  FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION,
  FARE_POLICY_REVIEWED_BY,
  MAX_POLICY_REVIEW_AGE_DAYS,
  validateFareCollectionPolicy,
} from "../../shared/lib/fareCollectionPolicy";

describe("fare collection policy", () => {
  const now = new Date("2026-07-18T20:51:40.000Z");
  const reviewed = FARE_COLLECTION_POLICY.map((entry) => ({
    ...entry,
    reviewedAt: new Date(
      now.getTime() - MAX_POLICY_REVIEW_AGE_DAYS * 86400000
    ).toISOString(),
    reviewedBy: "test",
    reviewedForCacheFlushGeneration: "generation-1",
  }));

  it("covers every ordered two-terminal route direction", () => {
    expect(FARE_COLLECTION_POLICY).toHaveLength(18);
    expect(
      new Set(
        FARE_COLLECTION_POLICY.map(
          (p) => `${p.departingTerminalId}:${p.arrivingTerminalId}`
        )
    ).size
    ).toBe(18);
    expect(FARE_COLLECTION_POLICY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departingTerminalId: "16",
          arrivingTerminalId: "21",
          sourceUrl:
            "https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/16/21",
        }),
        expect.objectContaining({
          departingTerminalId: "22",
          arrivingTerminalId: "20",
          sourceUrl:
            "https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/22/20",
        }),
      ])
    );
    for (const entry of FARE_COLLECTION_POLICY) {
      expect(entry.sourceUrl).not.toContain("apiaccesscode");
      expect(entry.reviewedAt).toBe(FARE_POLICY_REVIEWED_AT);
      expect(entry.reviewedBy).toBe(FARE_POLICY_REVIEWED_BY);
      expect(entry.reviewedForCacheFlushGeneration).toBe(
        FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION
      );
    }
  });

  it("accepts the audited generation and fails closed for another generation", () => {
    expect(
      validateFareCollectionPolicy(
        FARE_COLLECTION_POLICY,
        "16",
        "21",
        FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION,
        now
      )
    ).toMatchObject({ ok: true });
    expect(
      validateFareCollectionPolicy(
        FARE_COLLECTION_POLICY,
        "16",
        "21",
        "generation-2",
        now
      )
    ).toMatchObject({ ok: false });
  });

  it("requires a no-fare explanation and independently evaluates reverse directions", () => {
    expect(
      validateFareCollectionPolicy(reviewed, "21", "16", "generation-1", now)
    ).toMatchObject({ ok: true, value: { fareCollected: false } });
    expect(
      validateFareCollectionPolicy(reviewed, "16", "21", "generation-1", now)
    ).toMatchObject({ ok: true, value: { fareCollected: true } });
  });

  it("uses the audited WSDOT no-fare wording only for no-fare directions", () => {
    expect(
      FARE_COLLECTION_POLICY.find(
        (entry) =>
          entry.departingTerminalId === "21" && entry.arrivingTerminalId === "16"
      )
    ).toMatchObject({
      fareCollected: false,
      noFareMessage: "No fares are collected at Tahlequah.",
    });
    for (const [departingTerminalId, arrivingTerminalId] of [
      ["22", "9"],
      ["22", "20"],
    ]) {
      expect(
        FARE_COLLECTION_POLICY.find(
          (entry) =>
            entry.departingTerminalId === departingTerminalId &&
            entry.arrivingTerminalId === arrivingTerminalId
        )
      ).toMatchObject({
        fareCollected: false,
        noFareMessage: "No fares are collected at Vashon Island.",
      });
    }
    expect(
      FARE_COLLECTION_POLICY.filter((entry) => !entry.fareCollected)
    ).toHaveLength(3);
  });
});
