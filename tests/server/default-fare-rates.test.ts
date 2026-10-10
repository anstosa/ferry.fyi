import { afterEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../server/lib/logger", () => ({ default: logs }));

import {
  FARE_CACHE_FRESH_SECONDS,
  type FareCatalogStore,
  type FareQuoteStore,
} from "../../server/lib/fares";
import type { FareAdapter } from "../../server/lib/wsf/fares";
import { createPublicFareQueryService } from "../../server/services/public/fares";
import type {
  FareCatalog,
  FareFreshness,
  FareNoFare,
  FareQuote,
  FareQuoteRequest,
} from "../../shared/contracts/fares";
import type { FareCollectionPolicy } from "../../shared/lib/fareCollectionPolicy";

// hold provider work until concurrency assertions are observable
const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const now = new Date("2026-07-18T12:00:00.000Z");
const freshness: FareFreshness = {
  fetchedAt: Math.floor(now.getTime() / 1000),
  policyVersion: "test-v1",
  sourceCacheFlushDate: "generation-1",
  validFrom: "2026-07-01",
  validThrough: "2026-08-31",
};
const trip = {
  arrivingTerminalId: "21",
  departingTerminalId: "16",
  roundTrip: true,
  tripDate: "2026-07-20" as const,
};

// include only the two strict public default selections
const catalog = (request = trip): FareCatalog => ({
  collectionDescription: null,
  fares: [
    {
      amount: 11.35,
      category: "Passenger",
      directionIndependent: false,
      id: 101,
      label: "Adult (age 19 - 64)",
    },
    {
      amount: 40.5,
      category: "Vehicle",
      directionIndependent: false,
      id: 201,
      label: "Vehicle Under 22' (standard veh) & Driver",
    },
  ],
  freshness,
  kind: "catalog",
  request,
});

// return provider totals for the exact requested mode and selection
const quoteFor = (
  request: FareQuoteRequest,
  overrides: Partial<FareQuote> = {}
): FareQuote => {
  const isVehicle = request.lineItems[0]?.fareLineItemId === 201;
  const oneWay = isVehicle ? 20.25 : 11.35;
  return {
    freshness,
    kind: "quote",
    request,
    totals: request.roundTrip
      ? [
          {
            amount: oneWay,
            briefDescription: "Depart",
            description: "Departure fare",
            type: "depart",
          },
          {
            amount: isVehicle ? 40.5 : 11.35,
            briefDescription: "Total",
            description: "Exact total",
            type: "total",
          },
        ]
      : [
          {
            amount: oneWay,
            briefDescription: "Total",
            description: "Exact total",
            type: "total",
          },
        ],
    ...overrides,
  };
};

const catalogStore = (
  find: FareCatalogStore["find"] = vi.fn().mockResolvedValue(undefined)
): FareCatalogStore => ({
  find,
  findRefreshCandidates: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockResolvedValue(undefined),
});

const quoteStore = (
  findExact: FareQuoteStore["findExact"] = vi.fn().mockResolvedValue([])
): FareQuoteStore => ({
  findExact,
  save: vi.fn().mockResolvedValue(undefined),
});

const policy = (request = trip): FareCollectionPolicy => ({
  ...request,
  fareCollected: true,
  policyVersion: freshness.policyVersion,
  reviewedAt: "2026-07-18T00:00:00.000Z",
  reviewedBy: "test",
  reviewedForCacheFlushGeneration: freshness.sourceCacheFlushDate,
  sourceUrl: "https://example.test/wsdot",
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("public default fare rates", () => {
  // share only active enrichment work for the exact same public rate input
  it("coalesces identical active default-rate enrichments without caching settled results", async () => {
    const pendingQuotes: Array<{
      request: FareQuoteRequest;
      result: ReturnType<typeof deferred<FareQuote>>;
    }> = [];
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => {
        const result = deferred<FareQuote>();
        pendingQuotes.push({ request, result });
        return result.promise;
      }),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });
    const outcome = { catalog: catalog(), kind: "catalog" as const };

    const first = service.getDefaultRates(outcome, trip);
    const second = service.getDefaultRates(outcome, trip);
    await vi.waitFor(() => expect(adapter.getQuote).toHaveBeenCalledTimes(2));
    for (const quote of pendingQuotes.splice(0)) {
      quote.result.resolve(quoteFor(quote.request));
    }

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(adapter.getQuote).toHaveBeenCalledTimes(2);

    const third = service.getDefaultRates(outcome, trip);
    await vi.waitFor(() => expect(adapter.getQuote).toHaveBeenCalledTimes(4));
    for (const quote of pendingQuotes.splice(0)) {
      quote.result.resolve(quoteFor(quote.request));
    }

    await expect(third).resolves.toBeDefined();
    expect(adapter.getQuote).toHaveBeenCalledTimes(4);
  });

  // freshness generations and dates must retain independent provider work
  it("does not join default-rate enrichments across generation or date keys", async () => {
    const pendingQuotes: Array<{
      request: FareQuoteRequest;
      result: ReturnType<typeof deferred<FareQuote>>;
    }> = [];
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => {
        const result = deferred<FareQuote>();
        pendingQuotes.push({ request, result });
        return result.promise;
      }),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });
    const nextTrip = { ...trip, tripDate: "2026-07-21" as const };
    const changedGeneration = {
      catalog: {
        ...catalog(),
        freshness: {
          ...freshness,
          sourceCacheFlushDate: "generation-2",
        },
      },
      kind: "catalog" as const,
    };

    const lookups = [
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip),
      service.getDefaultRates(changedGeneration, trip),
      service.getDefaultRates(
        { catalog: catalog(nextTrip), kind: "catalog" },
        nextTrip
      ),
    ];
    await vi.waitFor(() => expect(adapter.getQuote).toHaveBeenCalledTimes(6));
    for (const quote of pendingQuotes.splice(0)) {
      quote.result.resolve(quoteFor(quote.request));
    }

    await expect(Promise.all(lookups)).resolves.toHaveLength(3);
  });

  // failed enrichment must leave no active result behind
  it("retries cleanly after a failed active default-rate enrichment", async () => {
    let fail = true;
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        fail
          ? Promise.reject(new Error("temporary quote failure"))
          : Promise.resolve(quoteFor(request))
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });
    const outcome = { catalog: catalog(), kind: "catalog" as const };

    await expect(
      Promise.all([
        service.getDefaultRates(outcome, trip),
        service.getDefaultRates(outcome, trip),
      ])
    ).resolves.toEqual([undefined, undefined]);
    expect(adapter.getQuote).toHaveBeenCalledTimes(2);

    fail = false;
    await expect(service.getDefaultRates(outcome, trip)).resolves.toBeDefined();
    expect(adapter.getQuote).toHaveBeenCalledTimes(4);
  });

  // use explicit official legs and totals without catalog arithmetic
  it("publishes current one-way and round-trip rates from exact true-mode quotes", async () => {
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => Promise.resolve(quoteFor(request))),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      policyEntries: [policy()],
      quoteStore: quoteStore(),
    });
    const outcome = { catalog: catalog(), kind: "catalog" as const };

    await expect(service.getDefaultRates(outcome, trip)).resolves.toEqual({
      passenger: {
        oneWay: { amount: 11.35, freshness, state: "current" },
        roundTrip: { amount: 11.35, freshness, state: "current" },
      },
      standardVehicle: {
        oneWay: { amount: 20.25, freshness, state: "current" },
        roundTrip: { amount: 40.5, freshness, state: "current" },
      },
    });
    expect(adapter.getQuote).toHaveBeenCalledWith({
      ...trip,
      lineItems: [{ fareLineItemId: 101, quantity: 1 }],
    });
    expect(adapter.getQuote).toHaveBeenCalledWith({
      ...trip,
      lineItems: [{ fareLineItemId: 201, quantity: 1 }],
    });
  });

  // preserve the narrower meaning of a false-mode total
  it("publishes false-mode totals as one-way only", async () => {
    const oneWayTrip = { ...trip, roundTrip: false };
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => Promise.resolve(quoteFor(request))),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    const rates = await service.getDefaultRates(
      { catalog: catalog(oneWayTrip), kind: "catalog" },
      oneWayTrip
    );

    expect(rates?.passenger.oneWay?.amount).toBe(11.35);
    expect(rates?.passenger.roundTrip).toBeNull();
    expect(rates?.standardVehicle.oneWay?.amount).toBe(20.25);
    expect(rates?.standardVehicle.roundTrip).toBeNull();
  });

  // exceptional quote failures log safe context and keep the catalog usable
  it("degrades thrown category lookups with sanitized diagnostics", async () => {
    const credentialCanary = "apiaccesscode=private-fare-key";
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockRejectedValue(new Error(credentialCanary)),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip)
    ).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith("Default fare rate lookup failed", {
      arrivingTerminalId: trip.arrivingTerminalId,
      category: "passenger",
      departingTerminalId: trip.departingTerminalId,
      tripDate: trip.tripDate,
    });
    expect(logs.warn).toHaveBeenCalledWith("Default fare rate lookup failed", {
      arrivingTerminalId: trip.arrivingTerminalId,
      category: "standardVehicle",
      departingTerminalId: trip.departingTerminalId,
      tripDate: trip.tripDate,
    });
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain(
      credentialCanary
    );
  });

  // typed provider unavailability is an expected quiet result
  it("degrades typed unavailable category lookups without warning", async () => {
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        Promise.resolve({
          calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
          kind: "unavailable" as const,
          reason: "generation-race" as const,
          request,
        })
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip)
    ).resolves.toBeUndefined();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  // preserve a successful passenger rate when the vehicle result is typed unavailable
  it("keeps independently available passenger rates when the vehicle quote is unavailable", async () => {
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        request.lineItems[0]?.fareLineItemId === 201
          ? Promise.resolve({
              calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
              kind: "unavailable" as const,
              reason: "generation-race" as const,
              request,
            })
          : Promise.resolve(quoteFor(request))
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip)
    ).resolves.toMatchObject({
      passenger: {
        oneWay: { amount: 11.35 },
        roundTrip: { amount: 11.35 },
      },
      standardVehicle: { oneWay: null, roundTrip: null },
    });
    expect(logs.warn).not.toHaveBeenCalled();
  });

  // sanitize a thrown vehicle failure without erasing the passenger result
  it("keeps passenger rates and sanitizes diagnostics when the vehicle quote throws", async () => {
    const credentialCanary = "apiaccesscode=mixed-private-fare-key";
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        request.lineItems[0]?.fareLineItemId === 201
          ? Promise.reject(new Error(credentialCanary))
          : Promise.resolve(quoteFor(request))
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip)
    ).resolves.toMatchObject({
      passenger: {
        oneWay: { amount: 11.35 },
        roundTrip: { amount: 11.35 },
      },
      standardVehicle: { oneWay: null, roundTrip: null },
    });
    expect(logs.warn).toHaveBeenCalledOnce();
    expect(logs.warn).toHaveBeenCalledWith("Default fare rate lookup failed", {
      arrivingTerminalId: trip.arrivingTerminalId,
      category: "standardVehicle",
      departingTerminalId: trip.departingTerminalId,
      tripDate: trip.tripDate,
    });
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain(
      credentialCanary
    );
  });

  // propagate aged cache truth while warming fixed defaults in the background
  it("marks boundary-aged cached default rates stale and warms them", async () => {
    const cachedFreshness = {
      ...freshness,
      fetchedAt: Math.floor(now.getTime() / 1000) - FARE_CACHE_FRESH_SECONDS,
    };
    const candidates = [101, 201].map((fareLineItemId) =>
      quoteFor(
        {
          ...trip,
          lineItems: [{ fareLineItemId, quantity: 1 }],
        },
        { freshness: cachedFreshness }
      )
    );
    const findExact = vi.fn((request: FareQuoteRequest) =>
      Promise.resolve(
        candidates.filter(
          (candidate) =>
            candidate.request.lineItems[0]?.fareLineItemId ===
            request.lineItems[0]?.fareLineItemId
        )
      )
    );
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => Promise.resolve(quoteFor(request))),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      policyEntries: [policy()],
      quoteStore: quoteStore(findExact),
    });

    const rates = await service.getDefaultRates(
      { catalog: catalog(), kind: "catalog" },
      trip
    );

    expect(rates?.passenger.oneWay).toMatchObject({
      freshness: { fetchedAt: cachedFreshness.fetchedAt },
      state: "stale",
    });
    expect(rates?.standardVehicle.roundTrip).toMatchObject({
      freshness: { fetchedAt: cachedFreshness.fetchedAt },
      state: "stale",
    });
    expect(adapter.getQuote).toHaveBeenCalledTimes(2);
    expect(findExact).toHaveBeenCalledTimes(2);
  });

  // stale quotes retain their own state and source timestamp
  it("preserves stale quote state for exact cached default selections", async () => {
    const staleFreshness = {
      ...freshness,
      fetchedAt: freshness.fetchedAt - 8 * 24 * 60 * 60,
    };
    const candidates = [101, 201].map((fareLineItemId) =>
      quoteFor(
        {
          ...trip,
          lineItems: [{ fareLineItemId, quantity: 1 }],
        },
        { freshness: staleFreshness }
      )
    );
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        Promise.resolve({
          calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
          kind: "unavailable" as const,
          reason: "upstream-unavailable" as const,
          request,
        })
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      policyEntries: [policy()],
      quoteStore: quoteStore(
        vi.fn((request: FareQuoteRequest) =>
          Promise.resolve(
            [
              candidates.find(
                (candidate) =>
                  candidate.request.lineItems[0]?.fareLineItemId ===
                  request.lineItems[0]?.fareLineItemId
              ),
            ].filter((candidate): candidate is FareQuote => Boolean(candidate))
          )
        )
      ),
    });

    const rates = await service.getDefaultRates(
      { catalog: catalog(), kind: "catalog" },
      trip
    );

    expect(rates?.passenger.oneWay).toMatchObject({
      freshness: { fetchedAt: staleFreshness.fetchedAt },
      state: "stale",
    });
    expect(rates?.standardVehicle.roundTrip).toMatchObject({
      freshness: { fetchedAt: staleFreshness.fetchedAt },
      state: "stale",
    });
  });

  // no-fare directions use explicit zero and exact reverse total evidence
  it("combines no-fare outbound zero with the reverse official round-trip total", async () => {
    const outbound = {
      arrivingTerminalId: "16",
      departingTerminalId: "21",
      roundTrip: true,
      tripDate: trip.tripDate,
    };
    const noFare: FareNoFare = {
      freshness: { ...freshness, fetchedAt: freshness.fetchedAt - 60 },
      kind: "no-fare",
      message: "No fare is collected in this direction.",
      request: outbound,
      sourceUrl: "https://example.test/wsdot/no-fare",
    };
    const reverseCatalog = catalog();
    const findReverseCatalog = vi.fn().mockResolvedValue(reverseCatalog);
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) => Promise.resolve(quoteFor(request))),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(findReverseCatalog),
      now: () => now,
      policyEntries: [policy()],
      quoteStore: quoteStore(),
    });

    const rates = await service.getDefaultRates(
      { kind: "no-fare", noFare },
      outbound
    );

    expect(rates?.passenger.oneWay).toEqual({
      amount: 0,
      freshness: noFare.freshness,
      state: "no-fare",
    });
    expect(rates?.passenger.roundTrip?.amount).toBe(11.35);
    expect(rates?.standardVehicle.roundTrip?.amount).toBe(40.5);
    expect(findReverseCatalog).toHaveBeenCalledWith({
      arrivingTerminalId: "21",
      departingTerminalId: "16",
      roundTrip: false,
      tripDate: trip.tripDate,
    });
    expect(adapter.getCatalog).not.toHaveBeenCalled();
  });

  // reverse policy gaps cannot erase or invent the explicit outbound zero
  it("keeps reverse rates unavailable when reverse catalog policy is missing", async () => {
    const outbound = {
      arrivingTerminalId: "16",
      departingTerminalId: "21",
      roundTrip: true,
      tripDate: trip.tripDate,
    };
    const noFare: FareNoFare = {
      freshness,
      kind: "no-fare",
      message: "No fare is collected in this direction.",
      request: outbound,
      sourceUrl: "https://example.test/wsdot/no-fare",
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn().mockResolvedValue({
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        kind: "unavailable",
        reason: "policy",
        request: { ...trip, roundTrip: false },
      }),
      getQuote: vi.fn(),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    const rates = await service.getDefaultRates(
      { kind: "no-fare", noFare },
      outbound
    );

    expect(rates?.passenger.oneWay?.amount).toBe(0);
    expect(rates?.passenger.roundTrip).toBeNull();
    expect(rates?.standardVehicle.oneWay?.state).toBe("no-fare");
    expect(rates?.standardVehicle.roundTrip).toBeNull();
    expect(adapter.getQuote).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  // exceptional reverse failures preserve explicit zero rates and redact errors
  it("degrades a thrown reverse lookup with sanitized diagnostics", async () => {
    const credentialCanary = "WSDOT_API_KEY=private-fare-key";
    const outbound = {
      arrivingTerminalId: "16",
      departingTerminalId: "21",
      roundTrip: true,
      tripDate: trip.tripDate,
    };
    const noFare: FareNoFare = {
      freshness,
      kind: "no-fare",
      message: "No fare is collected in this direction.",
      request: outbound,
      sourceUrl: "https://example.test/wsdot/no-fare",
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn().mockRejectedValue(new Error(credentialCanary)),
      getQuote: vi.fn(),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    const rates = await service.getDefaultRates(
      { kind: "no-fare", noFare },
      outbound
    );

    expect(rates?.passenger.oneWay?.amount).toBe(0);
    expect(rates?.passenger.roundTrip).toBeNull();
    expect(logs.warn).toHaveBeenCalledOnce();
    expect(logs.warn).toHaveBeenCalledWith(
      "Default fare reverse lookup failed",
      {
        arrivingTerminalId: outbound.departingTerminalId,
        category: "reverseCatalog",
        departingTerminalId: outbound.arrivingTerminalId,
        tripDate: outbound.tripDate,
      }
    );
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain(
      credentialCanary
    );
  });

  // reject provider echoes that do not match the known route and selection
  it("omits rates when quote echoes do not match the catalog request", async () => {
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn((request) =>
        Promise.resolve(
          quoteFor({ ...request, arrivingTerminalId: "unexpected" })
        )
      ),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore: catalogStore(),
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(
      service.getDefaultRates({ catalog: catalog(), kind: "catalog" }, trip)
    ).resolves.toBeUndefined();
  });
});
