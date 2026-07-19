import { Op } from "sequelize";
import type {
  FareCatalogResult,
  FareLineItemSelection,
  FareQuote,
  FareQuoteRequest,
  FareTripRequest,
} from "shared/contracts/fares";

import {
  catalogRequestFromRow,
  PERSISTED_FARE_CATALOG_EXACT_FIELDS,
  PersistedFareCatalog,
} from "~/models/PersistedFareCatalog";
import {
  PERSISTED_FARE_QUOTE_EXACT_FIELDS,
  PersistedFareQuote,
} from "~/models/PersistedFareQuote";

export const FARE_CACHE_FRESH_SECONDS = 6 * 60 * 60;
export const FARE_CACHE_STALE_SECONDS = 7 * 24 * 60 * 60;

/** Stored quote boundary so API tests and future cache backends stay database-free. */
export interface FareQuoteStore {
  findExact: (input: FareQuoteRequest) => Promise<FareQuote[]>;
  save: (quote: FareQuote) => Promise<void>;
}

/** Persistent catalog cache, kept separate from the per-selection quote cache. */
export interface FareCatalogStore {
  find: (input: FareTripRequest) => Promise<FareCatalogResult | undefined>;
  findRefreshCandidates: (
    before: number,
    limit: number
  ) => Promise<FareTripRequest[]>;
  save: (result: FareCatalogResult) => Promise<void>;
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

const catalogMatchesRequest = (
  result: FareCatalogResult,
  input: FareTripRequest
): boolean =>
  result.request.arrivingTerminalId === input.arrivingTerminalId &&
  result.request.departingTerminalId === input.departingTerminalId &&
  result.request.tripDate === input.tripDate;

export const sequelizeFareCatalogStore: FareCatalogStore = {
  async find(input) {
    const row = await PersistedFareCatalog.findOne({
      where: {
        arrivingTerminalId: input.arrivingTerminalId,
        departingTerminalId: input.departingTerminalId,
        tripDate: input.tripDate,
      },
    });
    return row && catalogMatchesRequest(row.result, input)
      ? row.result
      : undefined;
  },
  async findRefreshCandidates(before, limit) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await PersistedFareCatalog.findAll({
      limit,
      order: [["fetchedAt", "ASC"]],
      where: {
        fetchedAt: { [Op.lte]: before },
        tripDate: { [Op.gte]: today },
      },
    });
    return rows.map(catalogRequestFromRow);
  },
  async save(result) {
    await PersistedFareCatalog.upsert(
      {
        arrivingTerminalId: result.request.arrivingTerminalId,
        departingTerminalId: result.request.departingTerminalId,
        fetchedAt: result.freshness.fetchedAt,
        result,
        tripDate: result.request.tripDate,
      },
      { conflictFields: [...PERSISTED_FARE_CATALOG_EXACT_FIELDS] }
    );
  },
};
