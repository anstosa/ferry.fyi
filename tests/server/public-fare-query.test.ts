import { describe, expect, it, vi } from "vitest";

import type { FareCatalogStore, FareQuoteStore } from "../../server/lib/fares";
import type { FareAdapter } from "../../server/lib/wsf/fares";
import { createPublicFareQueryService } from "../../server/services/public/fares";
import type { FareCatalogResult } from "../../shared/contracts/fares";

const now = new Date("2026-07-18T12:00:00.000Z");
const trip = {
  arrivingTerminalId: "21",
  departingTerminalId: "16",
  roundTrip: false,
  tripDate: "2026-07-20" as const,
};
const catalog: FareCatalogResult = {
  collectionDescription: null,
  fares: [],
  freshness: {
    fetchedAt: Math.floor(now.getTime() / 1000),
    policyVersion: "test-v1",
    sourceCacheFlushDate: "generation-1",
    validFrom: "2026-07-01",
    validThrough: "2026-08-31",
  },
  kind: "catalog",
  request: trip,
};

const quoteStore = (): FareQuoteStore => ({
  findExact: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockResolvedValue(undefined),
});

describe("public fare query service", () => {
  it("serves a fresh catalog without an upstream call", async () => {
    const catalogStore: FareCatalogStore = {
      find: vi.fn().mockResolvedValue(catalog),
      findRefreshCandidates: vi.fn(),
      save: vi.fn(),
    };
    const adapter: FareAdapter = { getCatalog: vi.fn(), getQuote: vi.fn() };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore,
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(service.getCatalog(trip)).resolves.toEqual({
      catalog,
      kind: "catalog",
    });
    expect(adapter.getCatalog).not.toHaveBeenCalled();
  });

  it("persists a cold official catalog result but safely exposes unavailable input", async () => {
    const catalogStore: FareCatalogStore = {
      find: vi.fn().mockResolvedValue(undefined),
      findRefreshCandidates: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const adapter: FareAdapter = {
      getCatalog: vi.fn().mockResolvedValue(catalog),
      getQuote: vi.fn(),
    };
    const service = createPublicFareQueryService({
      adapter,
      catalogStore,
      now: () => now,
      quoteStore: quoteStore(),
    });

    await expect(service.getCatalog(trip)).resolves.toEqual({
      catalog,
      kind: "catalog",
    });
    expect(catalogStore.save).toHaveBeenCalledWith(catalog);
  });
});
