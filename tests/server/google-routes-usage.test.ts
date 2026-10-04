import { describe, expect, it } from "vitest";

import {
  createGoogleRoutesUsageStore,
  getGoogleRoutesPacificMonth,
  GOOGLE_ROUTES_USAGE_LIMITS,
  toGoogleRoutesUsageSnapshot,
} from "../../server/lib/googleRoutesUsage";

describe("Google Routes usage accounting", () => {
  // bind monthly resets to Pacific time rather than UTC
  it("keeps the original Pacific month across the UTC boundary", () => {
    expect(getGoogleRoutesPacificMonth(new Date("2026-10-01T06:59:59Z"))).toBe(
      "2026-09"
    );
    expect(getGoogleRoutesPacificMonth(new Date("2026-10-01T07:00:00Z"))).toBe(
      "2026-10"
    );
  });

  // preserve failures and unresolved attempts in conservative cost alerts
  it("derives success, failure, and unresolved counts", () => {
    expect(
      toGoogleRoutesUsageSnapshot({
        attemptCount: 10,
        knownFailureCount: 2,
        month: "2026-10",
        sku: "compute_routes_pro",
        successCount: 7,
      } as never)
    ).toEqual({
      attemptCount: 10,
      estimatedBillable: 10,
      knownFailureCount: 2,
      month: "2026-10",
      sku: "compute_routes_pro",
      successCount: 7,
      unresolvedCount: 1,
    });
  });

  // lock the current per-SKU free-tier transition counts
  it("uses the approved 80 and 100 percent request thresholds", () => {
    expect(GOOGLE_ROUTES_USAGE_LIMITS).toEqual({
      autocomplete_requests: { reached100: 10_000, reached80: 8_000 },
      compute_routes_essentials: { reached100: 10_000, reached80: 8_000 },
      compute_routes_pro: { reached100: 5_000, reached80: 4_000 },
    });
  });

  // emit a transition only when the conservative estimate reaches the threshold
  it("marks the Pro 80 percent transition once", async () => {
    const events: unknown[] = [];
    const row = {
      attemptCount: 3_999,
      knownFailureCount: 200,
      month: "2026-10",
      reached100At: null,
      reached80At: null as Date | null,
      sku: "compute_routes_pro" as const,
      successCount: 3_799,
      // model an atomic database increment
      async increment() {
        this.attemptCount += 1;
      },
      // keep the locked row current
      async reload() {},
      // persist transition timestamps
      async save() {},
    };
    const model = {
      // execute the callback under one synthetic transaction
      sequelize: {
        async transaction(callback: (transaction: unknown) => Promise<void>) {
          await callback({ LOCK: { UPDATE: "UPDATE" } });
        },
      },
      // return the same locked aggregate
      async findOrCreate() {
        return [row, false];
      },
      // complete is unused in this transition test
      async increment() {},
      // list is unused in this transition test
      async findAll() {
        return [];
      },
    };
    const store = createGoogleRoutesUsageStore({
      emitAlert: (event) => events.push(event),
      model: model as never,
    });

    await store.open("compute_routes_pro", new Date("2026-10-02T08:00:00Z"));
    await store.open("compute_routes_pro", new Date("2026-10-02T08:01:00Z"));

    expect(events).toEqual([
      {
        estimatedBillable: 4_000,
        month: "2026-10",
        sku: "compute_routes_pro",
        threshold: 80,
      },
    ]);
  });

  // carry the original month handle through a post-midnight completion
  it("completes against the month captured before provider I/O", async () => {
    const increments: unknown[] = [];
    const model = {
      // capture the immutable completion selector
      async increment(field: string, options: unknown) {
        increments.push({ field, options });
      },
    };
    const store = createGoogleRoutesUsageStore({ model: model as never });

    await store.complete(
      { month: "2026-09", sku: "compute_routes_essentials" },
      "success"
    );

    expect(increments).toEqual([
      {
        field: "successCount",
        options: {
          by: 1,
          where: {
            month: "2026-09",
            sku: "compute_routes_essentials",
          },
        },
      },
    ]);
  });
});
