import { describe, expect, it } from "vitest";

import {
  FARE_COLLECTION_POLICY,
  MAX_POLICY_REVIEW_AGE_DAYS,
  validateFareCollectionPolicy,
} from "../../shared/lib/fareCollectionPolicy";

describe("fare collection policy", () => {
  const now = new Date("2026-07-18T00:00:00.000Z");
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
  });

  it("fails closed until the policy is reviewed for the live generation", () => {
    expect(
      validateFareCollectionPolicy(
        FARE_COLLECTION_POLICY,
        "16",
        "21",
        "generation-1",
        now
      )
    ).toMatchObject({ ok: false });
    expect(
      validateFareCollectionPolicy(reviewed, "16", "21", "generation-1", now)
    ).toMatchObject({ ok: true });
    expect(
      validateFareCollectionPolicy(reviewed, "16", "21", "generation-2", now)
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
});
