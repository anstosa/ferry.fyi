import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { wrapApiResponse } from "../../server/controllers/api";
import {
  createFareRouter,
} from "../../server/controllers/api/fares";
import type {
  FareCatalogStore,
  FareQuoteStore,
} from "../../server/lib/fares";
import type { FareAdapter } from "../../server/lib/wsf/fares";
import type {
  FareCatalogResult,
  FareQuote,
} from "../../shared/contracts/fares";
import type { FareCollectionPolicy } from "../../shared/lib/fareCollectionPolicy";

const now = new Date("2026-07-18T12:00:00.000Z");
const trip = {
  arrivingTerminalId: "21",
  departingTerminalId: "16",
  roundTrip: true,
  tripDate: "2026-07-20" as const,
};
const policy: FareCollectionPolicy = {
  ...trip,
  fareCollected: true,
  policyVersion: "test-v1",
  reviewedAt: "2026-07-18T00:00:00.000Z",
  reviewedBy: "test",
  reviewedForCacheFlushGeneration: "generation-1",
  sourceUrl: "https://example.test/wsdot",
};
const quote: FareQuote = {
  freshness: {
    fetchedAt: 1784376000,
    policyVersion: "test-v1",
    sourceCacheFlushDate: "generation-1",
    validFrom: "2026-07-01",
    validThrough: "2026-08-31",
  },
  kind: "quote",
  request: { ...trip, lineItems: [{ fareLineItemId: 101, quantity: 2 }] },
  totals: [
    {
      amount: 18.5,
      briefDescription: "Total",
      description: "Official total",
      type: "total",
    },
  ],
};

const appFor = (
  adapter: FareAdapter,
  store: FareQuoteStore,
  policyEntries: FareCollectionPolicy[] = [policy],
  catalogStore: FareCatalogStore = catalogCache()
) => {
  const app = express();
  app.use(express.json());
  app.use(wrapApiResponse);
  app.use(
    "/fares",
    createFareRouter({
      adapter,
      catalogStore,
      now: () => now,
      policyEntries,
      quoteStore: store,
    })
  );
  return app;
};

const store = (candidates: FareQuote[] = []): FareQuoteStore => ({
  findExact: vi.fn().mockResolvedValue(candidates),
  save: vi.fn().mockResolvedValue(undefined),
});

const catalogCache = (
  result?: FareCatalogResult
): FareCatalogStore => ({
  find: vi.fn().mockResolvedValue(result),
  findRefreshCandidates: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockResolvedValue(undefined),
});

describe("anonymous fare API", () => {
  it("persists only a normalized current quote and preserves the API envelope", async () => {
    const quoteStore = store();
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue(quote),
    };
    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({
        ...trip,
        // The public input's mode is ignored; adapter/policy owns it.
        roundTrip: false,
        lineItems: [
          { fareLineItemId: 101, quantity: 1 },
          { fareLineItemId: 101, quantity: 1 },
        ],
      })
      .expect(200);

    expect(response.body.body).toEqual({ quote, state: "current" });
    expect(quoteStore.save).toHaveBeenCalledWith(quote);
    expect(adapter.getQuote).toHaveBeenCalledWith({
      ...trip,
      lineItems: [
        { fareLineItemId: 101, quantity: 1 },
        { fareLineItemId: 101, quantity: 1 },
      ],
      roundTrip: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/apiaccesscode|WSDOT_API_KEY/i);
  });

  it("returns a current quote when best-effort cache persistence fails", async () => {
    const quoteStore: FareQuoteStore = {
      findExact: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue(quote),
    };

    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({ ...trip, lineItems: quote.request.lineItems })
      .expect(200);

    expect(response.body.body).toEqual({ quote, state: "current" });
  });

  it("serves a fresh exact quote from the database without another WSDOT call", async () => {
    const quoteStore = store([quote]);
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn(),
    };

    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({ ...trip, lineItems: quote.request.lineItems })
      .expect(200);

    expect(response.body.body).toEqual({ quote, state: "current" });
    expect(adapter.getQuote).not.toHaveBeenCalled();
  });

  it("returns stale only for an exact, valid-range, policy-gated quote after upstream failure", async () => {
    const quoteStore = store([
      {
        ...quote,
        freshness: {
          ...quote.freshness,
          fetchedAt: quote.freshness.fetchedAt - 8 * 24 * 60 * 60,
        },
      },
    ]);
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue({
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        kind: "unavailable",
        reason: "upstream-unavailable",
        request: { ...trip, lineItems: quote.request.lineItems },
      }),
    };
    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({ ...trip, lineItems: quote.request.lineItems })
      .expect(200);

    expect(response.body.body).toMatchObject({
      quote: expect.objectContaining({
        freshness: expect.objectContaining({
          fetchedAt: quote.freshness.fetchedAt - 8 * 24 * 60 * 60,
        }),
      }),
      staleAt: quote.freshness.fetchedAt - 8 * 24 * 60 * 60,
      state: "stale",
    });
    expect(quoteStore.findExact).toHaveBeenCalledTimes(2);
  });

  it("rejects stale candidates whose canonical selections do not match", async () => {
    const quoteStore = store([quote]);
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue({
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        kind: "unavailable",
        reason: "upstream-unavailable",
        request: { ...trip, lineItems: [{ fareLineItemId: 101, quantity: 1 }] },
      }),
    };

    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({ ...trip, lineItems: [{ fareLineItemId: 101, quantity: 1 }] })
      .expect(200);

    expect(response.body.body).toEqual({
      calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
      reason: "unavailable",
      state: "unavailable",
    });
  });

  it("returns typed unavailable when stale quote lookup fails", async () => {
    const quoteStore: FareQuoteStore = {
      findExact: vi.fn().mockRejectedValue(new Error("database unavailable")),
      save: vi.fn(),
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue({
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        kind: "unavailable",
        reason: "upstream-unavailable",
        request: { ...trip, lineItems: quote.request.lineItems },
      }),
    };

    const response = await request(appFor(adapter, quoteStore))
      .post("/fares/quote")
      .send({ ...trip, lineItems: quote.request.lineItems })
      .expect(200);

    expect(response.body.body).toEqual({
      calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
      reason: "unavailable",
      state: "unavailable",
    });
  });

  it("never uses stale fallback for invalid input, a generation race, or missing policy", async () => {
    const quoteStore = store([quote]);
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn().mockResolvedValue({
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        kind: "unavailable",
        reason: "generation-race",
        request: { ...trip, lineItems: quote.request.lineItems },
      }),
    };
    const app = appFor(adapter, quoteStore, []);
    const raced = await request(app)
      .post("/fares/quote")
      .send({ ...trip, lineItems: quote.request.lineItems });
    expect(raced.body.body).toEqual({
      calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
      reason: "unavailable",
      state: "unavailable",
    });
    const invalid = await request(app)
      .post("/fares/quote")
      .send({ ...trip, lineItems: [{ fareLineItemId: -1, quantity: 1 }] });
    expect(invalid.body.body).toEqual({
      calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
      reason: "unavailable",
      state: "unavailable",
    });
    // Invalid ids bypass the cache; a valid generation-race request can still read it.
    expect(quoteStore.findExact).toHaveBeenCalledOnce();
  });

  it("returns policy-declared no-fare catalog data with its official source URL", async () => {
    const quoteStore = store();
    const adapter: FareAdapter = {
      getCatalog: vi.fn().mockResolvedValue({
        freshness: quote.freshness,
        kind: "no-fare",
        message: "No fare is collected in this direction.",
        request: trip,
        sourceUrl: "https://example.test/wsdot/no-fare",
      }),
      getQuote: vi.fn(),
    };
    const response = await request(appFor(adapter, quoteStore))
      .get("/fares/catalog")
      .query({
        arrivingTerminalId: trip.arrivingTerminalId,
        departingTerminalId: trip.departingTerminalId,
        tripDate: trip.tripDate,
      });
    expect(response.body.body).toMatchObject({
      noFare: { sourceUrl: "https://example.test/wsdot/no-fare" },
      state: "no-fare",
    });
  });

  it("serves a fresh catalog from the database without another WSDOT request", async () => {
    const catalog: FareCatalogResult = {
      fares: [{ amount: 10, category: "Vehicle", directionIndependent: false, id: 1, label: "Car" }],
      freshness: quote.freshness,
      kind: "catalog",
      request: { ...trip, roundTrip: false },
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn(),
      getQuote: vi.fn(),
    };
    const response = await request(appFor(adapter, store(), [policy], catalogCache(catalog)))
      .get("/fares/catalog")
      .query({
        arrivingTerminalId: trip.arrivingTerminalId,
        departingTerminalId: trip.departingTerminalId,
        tripDate: trip.tripDate,
      })
      .expect(200);

    expect(response.body.body).toEqual({ catalog, state: "current" });
    expect(adapter.getCatalog).not.toHaveBeenCalled();
  });
});
