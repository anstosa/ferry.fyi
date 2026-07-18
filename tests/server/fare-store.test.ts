import { describe, expect, it, vi } from "vitest";

const persistedFareQuote = vi.hoisted(() => ({
  findAll: vi.fn(),
  upsert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/models/PersistedFareQuote", () => ({
  PersistedFareQuote: persistedFareQuote,
  PERSISTED_FARE_QUOTE_EXACT_FIELDS: [
    "departingTerminalId",
    "arrivingTerminalId",
    "tripDate",
    "roundTrip",
    "canonicalSelections",
    "sourceCacheFlushDate",
  ],
}));

import { sequelizeFareQuoteStore } from "../../server/lib/fares";
import type { FareQuote } from "../../shared/contracts/fares";

const quote: FareQuote = {
  freshness: {
    fetchedAt: 1784376000,
    policyVersion: "test-v1",
    sourceCacheFlushDate: "generation-1",
    validFrom: "2026-07-01",
    validThrough: "2026-08-31",
  },
  kind: "quote",
  request: {
    arrivingTerminalId: "21",
    departingTerminalId: "16",
    lineItems: [{ fareLineItemId: 101, quantity: 2 }],
    roundTrip: true,
    tripDate: "2026-07-20",
  },
  totals: [],
};

describe("Sequelize fare quote store", () => {
  it("upserts repeated identical quotes using the exact generation key", async () => {
    await sequelizeFareQuoteStore.save(quote);
    await sequelizeFareQuoteStore.save(quote);

    expect(persistedFareQuote.upsert).toHaveBeenCalledTimes(2);
    expect(persistedFareQuote.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canonicalSelections: JSON.stringify([
          { fareLineItemId: 101, quantity: 2 },
        ]),
      }),
      {
        conflictFields: [
          "departingTerminalId",
          "arrivingTerminalId",
          "tripDate",
          "roundTrip",
          "canonicalSelections",
          "sourceCacheFlushDate",
        ],
      }
    );
  });
});
