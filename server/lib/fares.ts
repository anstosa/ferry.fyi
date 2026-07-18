import type {
  FareLineItemSelection,
  FareQuote,
  FareQuoteRequest,
} from "shared/contracts/fares";

import {
  PersistedFareQuote,
  PERSISTED_FARE_QUOTE_EXACT_FIELDS,
} from "~/models/PersistedFareQuote";

/** Stored quote boundary so API tests and future cache backends stay database-free. */
export interface FareQuoteStore {
  findExact: (input: FareQuoteRequest) => Promise<FareQuote[]>;
  save: (quote: FareQuote) => Promise<void>;
}

export const canonicalFareSelections = (
  selections: FareLineItemSelection[]
): string | undefined => {
  const quantities = new Map<number, number>();
  for (const selection of selections) {
    if (
      !Number.isInteger(selection.fareLineItemId) ||
      selection.fareLineItemId <= 0 ||
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 0
    ) {
      return undefined;
    }
    if (selection.quantity > 0) {
      quantities.set(
        selection.fareLineItemId,
        (quantities.get(selection.fareLineItemId) ?? 0) + selection.quantity
      );
    }
  }
  const normalized = [...quantities]
    .map(([fareLineItemId, quantity]) => ({ fareLineItemId, quantity }))
    .sort((a, b) => a.fareLineItemId - b.fareLineItemId);
  return normalized.length ? JSON.stringify(normalized) : undefined;
};

const quoteToRow = (quote: FareQuote) => ({
  arrivingTerminalId: quote.request.arrivingTerminalId,
  canonicalSelections: canonicalFareSelections(quote.request.lineItems),
  departingTerminalId: quote.request.departingTerminalId,
  fetchedAt: quote.freshness.fetchedAt,
  policyVersion: quote.freshness.policyVersion,
  quote,
  roundTrip: quote.request.roundTrip,
  sourceCacheFlushDate: quote.freshness.sourceCacheFlushDate,
  tripDate: quote.request.tripDate,
  validFrom: quote.freshness.validFrom,
  validThrough: quote.freshness.validThrough,
});

/**
 * Persist only fully normalized, stable-generation quotes.  A null/invalid
 * fingerprint or incomplete freshness metadata is intentionally not cached.
 */
export const sequelizeFareQuoteStore: FareQuoteStore = {
  async findExact(input) {
    const canonicalSelections = canonicalFareSelections(input.lineItems);
    if (!canonicalSelections) {
      return [];
    }
    const rows = await PersistedFareQuote.findAll({
      order: [["fetchedAt", "DESC"]],
      where: {
        arrivingTerminalId: input.arrivingTerminalId,
        canonicalSelections,
        departingTerminalId: input.departingTerminalId,
        tripDate: input.tripDate,
      },
    });
    return rows.map((row) => row.quote);
  },
  async save(quote) {
    const row = quoteToRow(quote);
    if (
      !row.canonicalSelections ||
      !row.sourceCacheFlushDate ||
      !row.validFrom ||
      !row.validThrough ||
      !row.policyVersion
    ) {
      return;
    }
    await PersistedFareQuote.upsert(row, {
      // Do not let Sequelize fall back to the surrogate id for this cache key.
      conflictFields: [...PERSISTED_FARE_QUOTE_EXACT_FIELDS],
    });
  },
};
