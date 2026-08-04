import { describe, expect, it } from "vitest";

import {
  calculateAvailability,
  calculateOperationLag,
  calculateSourceAge,
  percentile,
  rate,
} from "../../shared/lib/observability";

const now = "2026-08-04T00:00:00.000Z";

describe("observability formulas", () => {
  it("uses nearest-rank percentiles and rejects invalid samples", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([1, Number.NaN], 0.95)).toBeNull();
  });

  it("computes bounded rates", () => {
    expect(rate(2, 4)).toBe(0.5);
    expect(rate(1, 0)).toBeNull();
    expect(rate(5, 4)).toBeNull();
  });

  it("makes missing samples fail and requires 95 percent coverage", () => {
    expect(
      calculateAvailability({
        observedAttempts: 94,
        plannedMaintenanceAttempts: 2,
        scheduledAttempts: 102,
        successfulAttempts: 93,
      })
    ).toEqual({
      availability: 0.93,
      coverage: 0.94,
      denominator: 100,
      missingAttempts: 6,
      reportable: false,
      successfulAttempts: 93,
    });
    expect(
      calculateAvailability({
        evidencedMonitorOutageAttempts: 2,
        observedAttempts: 98,
        plannedMaintenanceAttempts: 2,
        scheduledAttempts: 102,
        successfulAttempts: 98,
      })
    ).toMatchObject({
      availability: 1,
      coverage: 1,
      denominator: 98,
      reportable: true,
    });
  });

  it("never turns unavailable, malformed, or future source times into ages", () => {
    expect(
      calculateSourceAge({ retrievedAt: now, sourceTimestamp: null })
    ).toEqual({ ageMs: null, outcome: "unavailable" });
    expect(
      calculateSourceAge({ retrievedAt: now, sourceTimestamp: "bad" })
    ).toEqual({ ageMs: null, outcome: "invalid" });
    expect(
      calculateSourceAge({
        retrievedAt: now,
        sourceTimestamp: "2026-08-04T00:00:01.000Z",
      })
    ).toEqual({ ageMs: null, outcome: "future" });
    expect(
      calculateSourceAge({
        retrievedAt: now,
        sourceTimestamp: "2026-08-03T23:59:00.000Z",
      })
    ).toEqual({ ageMs: 60_000, outcome: "valid" });
  });

  it.each([
    {
      expected: "never-run",
      input: {
        endedAt: null,
        leaseExpiresAt: null,
        startedAt: null,
        status: "idle" as const,
      },
    },
    {
      expected: "running",
      input: {
        endedAt: null,
        leaseExpiresAt: "2026-08-04T00:01:00.000Z",
        startedAt: "2026-08-03T23:59:30.000Z",
        status: "running" as const,
      },
    },
    {
      expected: "succeeded",
      input: {
        endedAt: "2026-08-03T23:59:30.000Z",
        leaseExpiresAt: null,
        startedAt: "2026-08-03T23:59:00.000Z",
        status: "succeeded" as const,
      },
    },
    {
      expected: "failed",
      input: {
        endedAt: "2026-08-03T23:59:30.000Z",
        leaseExpiresAt: null,
        startedAt: "2026-08-03T23:59:00.000Z",
        status: "failed" as const,
      },
    },
    {
      expected: "stale",
      input: {
        endedAt: null,
        leaseExpiresAt: "2026-08-03T23:59:59.000Z",
        startedAt: "2026-08-03T23:59:00.000Z",
        status: "running" as const,
      },
    },
    {
      expected: "overdue",
      input: {
        endedAt: "2026-08-03T23:57:00.000Z",
        leaseExpiresAt: null,
        startedAt: "2026-08-03T23:56:30.000Z",
        status: "succeeded" as const,
      },
    },
  ])("classifies operation state as $expected", ({ expected, input }) => {
    expect(
      calculateOperationLag({ cadenceMs: 60_000, ...input }, now).outcome
    ).toBe(expected);
  });
});
