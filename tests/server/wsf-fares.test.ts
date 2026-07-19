import { describe, expect, it, vi } from "vitest";

import {
  createFareAdapter,
  WSDOT_FARE_CALCULATOR_URL,
} from "../../server/lib/wsf/fares";
import {
  FARE_COLLECTION_POLICY,
  FareCollectionPolicy,
  validateFareCollectionPolicy,
} from "../../shared/lib/fareCollectionPolicy";

const now = new Date("2026-07-18T12:00:00.000Z");
const request = {
  arrivingTerminalId: "21",
  departingTerminalId: "16",
  roundTrip: false,
  tripDate: "2026-07-20" as const,
};

const reviewedPolicy = (generation: string): FareCollectionPolicy[] =>
  FARE_COLLECTION_POLICY.map((entry) => ({
    ...entry,
    reviewedAt: now.toISOString(),
    reviewedBy: "test",
    reviewedForCacheFlushGeneration: generation,
  }));

const policyForGeneration = (generation: string) => {
  const entry = reviewedPolicy(generation).find(
    (policy) =>
      policy.departingTerminalId === request.departingTerminalId &&
      policy.arrivingTerminalId === request.arrivingTerminalId
  );
  if (!entry) {
    throw new Error("Missing fixture policy");
  }
  return { ok: true as const, value: entry };
};

const fareLineItems = [
  {
    Amount: 9.25,
    Category: "Passenger",
    DirectionIndependent: true,
    FareLineItem: "Adult",
    FareLineItemID: 101,
  },
];

const fareTotals = [
  {
    Amount: 18.5,
    BriefDescription: "Total",
    Description: "Total fare",
    TotalType: "Total" as const,
  },
];

const createRequest = (
  generations: Array<string | undefined>,
  unavailablePath?: RegExp,
  totals = fareTotals
) => {
  const read = vi.fn(async (path: string) => {
    if (unavailablePath?.test(path)) {
      return undefined;
    }
    if (path.endsWith("/cacheflushdate")) {
      return generations.shift();
    }
    if (path.endsWith("/validdaterange")) {
      return {
        EndDate: "/Date(1788130800000-0700)/",
        StartDate: "/Date(1782889200000-0700)/",
      };
    }
    if (path.endsWith("/terminals/2026-07-20")) {
      return [{ TerminalID: 16 }, { TerminalID: 21 }];
    }
    if (path.endsWith("/terminalmates/2026-07-20/16")) {
      return [{ TerminalID: 21 }];
    }
    if (path.endsWith("/terminalcomboverbose/2026-07-20")) {
      return [{ ArrivingTerminalID: 21, DepartingTerminalID: 16 }];
    }
    if (path.includes("/farelineitems/2026-07-20/16/21/true")) {
      return fareLineItems;
    }
    if (path.includes("/faretotals/2026-07-20/16/21/true/101/2")) {
      return totals;
    }
    throw new Error(`Unexpected WSDOT request: ${path}`);
  });
  return read;
};

describe("WSF fare adapter", () => {
  it("allows the fare-collection direction from Anacortes to Lopez", () => {
    const policy = validateFareCollectionPolicy(
      FARE_COLLECTION_POLICY,
      "1",
      "13",
      "/Date(1784324310423-0700)/",
      new Date("2026-07-19T17:00:00.000Z")
    );

    expect(policy).toMatchObject({
      ok: true,
      value: { fareCollected: true, roundTrip: true },
    });
  });

  it("uses exact directory/mate/combo terminal IDs and returns a stable catalog", async () => {
    const source = createRequest(["generation-1", "generation-1"]);
    const adapter = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: source,
    });

    await expect(adapter.getCatalog(request)).resolves.toMatchObject({
      fares: [{ id: 101 }],
      kind: "catalog",
      request: { ...request, roundTrip: true },
    });
    expect(source).toHaveBeenCalledWith(
      "https://www.wsdot.wa.gov/ferries/api/fares/rest/terminals/2026-07-20"
    );
    expect(source).toHaveBeenCalledWith(
      "https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalmates/2026-07-20/16"
    );
    expect(source).toHaveBeenCalledWith(
      "https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcomboverbose/2026-07-20"
    );
  });

  it("normalizes selections before totals and rejects selections absent from the exact catalog", async () => {
    const source = createRequest(["generation-1", "generation-1"]);
    const adapter = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: source,
    });

    const quote = await adapter.getQuote({
      ...request,
      lineItems: [
        { fareLineItemId: 101, quantity: 1 },
        { fareLineItemId: 101, quantity: 1 },
        { fareLineItemId: 101, quantity: 0 },
      ],
    });
    expect(quote).toMatchObject({
      kind: "quote",
      request: { lineItems: [{ fareLineItemId: 101, quantity: 2 }] },
      totals: [{ amount: 18.5, type: "total" }],
    });
    expect(source).toHaveBeenCalledWith(
      "https://www.wsdot.wa.gov/ferries/api/fares/rest/faretotals/2026-07-20/16/21/true/101/2"
    );

    const invalidSource = createRequest(["generation-1"]);
    const adapterForInvalidSource = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: invalidSource,
    });
    const unavailable = await adapterForInvalidSource.getQuote({
      ...request,
      lineItems: [{ fareLineItemId: 404, quantity: 1 }],
    });
    expect(unavailable).toMatchObject({
      kind: "unavailable",
      reason: "invalid-source",
    });
  });

  it("accepts WSDOT's numeric fare total types", async () => {
    const source = createRequest(
      ["generation-1", "generation-1"],
      undefined,
      fareTotals.map((total) => ({ ...total, TotalType: 4 }))
    );
    const adapter = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: source,
    });

    await expect(
      adapter.getQuote({
        ...request,
        lineItems: [{ fareLineItemId: 101, quantity: 2 }],
      })
    ).resolves.toMatchObject({ kind: "quote", totals: [{ type: "total" }] });
  });

  it("discards a G1/G2 race and retries the full catalog sequence once", async () => {
    const source = createRequest([
      "generation-1",
      "generation-2",
      "generation-2",
      "generation-2",
    ]);
    const adapter = createFareAdapter({
      now: () => now,
      policyValidator: (
        _departingTerminalId,
        _arrivingTerminalId,
        generation
      ) => policyForGeneration(generation),
      request: source,
    });

    await expect(adapter.getCatalog(request)).resolves.toMatchObject({
      kind: "catalog",
      freshness: { sourceCacheFlushDate: "generation-2" },
    });
    expect(
      source.mock.calls.filter(([path]) => path.endsWith("/cacheflushdate"))
    ).toHaveLength(4);
  });

  it("returns typed unavailable after a second G1/G2 race", async () => {
    const source = createRequest([
      "generation-1",
      "generation-2",
      "generation-2",
      "generation-3",
    ]);
    const adapter = createFareAdapter({
      now: () => now,
      policyValidator: (
        _departingTerminalId,
        _arrivingTerminalId,
        generation
      ) => policyForGeneration(generation),
      request: source,
    });

    await expect(adapter.getCatalog(request)).resolves.toEqual({
      calculatorUrl: WSDOT_FARE_CALCULATOR_URL,
      kind: "unavailable",
      reason: "generation-race",
      request,
    });
  });

  it("preserves upstream-unavailable when a later source request is absent", async () => {
    const source = createRequest(["generation-1"], /terminalmates/);
    const adapter = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: source,
    });

    await expect(adapter.getCatalog(request)).resolves.toMatchObject({
      kind: "unavailable",
      reason: "upstream-unavailable",
    });
  });

  it("preserves upstream-unavailable when the final generation read is absent", async () => {
    const source = createRequest(["generation-1", undefined]);
    const adapter = createFareAdapter({
      now: () => now,
      policyEntries: reviewedPolicy("generation-1"),
      request: source,
    });

    await expect(adapter.getCatalog(request)).resolves.toMatchObject({
      kind: "unavailable",
      reason: "upstream-unavailable",
    });
    expect(
      source.mock.calls.filter(([path]) => path.endsWith("/cacheflushdate"))
    ).toHaveLength(2);
  });
});
