import type {
  FareCatalog,
  FareCatalogResult,
  FareNoFare,
  FareQuote,
  FareQuoteRequest,
  FareTripRequest,
} from "shared/contracts/fares";
import {
  FARE_COLLECTION_POLICY,
  type FareCollectionPolicy,
  validateFareCollectionPolicy,
} from "shared/lib/fareCollectionPolicy";

import {
  warmFareCatalogInBackground,
  warmFareQuoteInBackground,
} from "../../lib/fareCache";
import {
  canonicalFareSelections,
  FARE_CACHE_FRESH_SECONDS,
  FARE_CACHE_STALE_SECONDS,
  type FareCatalogStore,
  type FareQuoteStore,
  sequelizeFareCatalogStore,
  sequelizeFareQuoteStore,
} from "../../lib/fares";
import {
  createFareAdapter,
  type FareAdapter,
  type FareUnavailable,
} from "../../lib/wsf/fares";

export interface PublicFareQueryDependencies {
  adapter?: FareAdapter;
  catalogStore?: FareCatalogStore;
  now?: () => Date;
  policyEntries?: FareCollectionPolicy[];
  quoteStore?: FareQuoteStore;
}

export type PublicFareCatalogOutcome =
  | { catalog: FareCatalog; kind: "catalog" }
  | { kind: "no-fare"; noFare: FareNoFare }
  | { kind: "unavailable"; reason: FareUnavailable["reason"] };

export type PublicFareQuoteOutcome =
  | { kind: "quote"; quote: FareQuote }
  | { kind: "no-fare"; noFare: FareNoFare }
  | { kind: "stale"; quote: FareQuote; staleAt: number }
  | { kind: "unavailable"; reason: FareUnavailable["reason"] };

const cacheAgeSeconds = (fetchedAt: number, now: Date): number =>
  Math.floor(now.getTime() / 1000) - fetchedAt;

const isUsableCachedResult = (fetchedAt: number, now: Date): boolean =>
  Number.isFinite(fetchedAt) &&
  cacheAgeSeconds(fetchedAt, now) >= 0 &&
  cacheAgeSeconds(fetchedAt, now) <= FARE_CACHE_STALE_SECONDS;

const candidateIsExactAndEligible = (
  quote: FareQuote,
  request: FareQuoteRequest,
  policyEntries: FareCollectionPolicy[],
  now: Date
): boolean => {
  const { freshness } = quote;
  const candidateSelections = canonicalFareSelections(quote.request.lineItems);
  const requestedSelections = canonicalFareSelections(request.lineItems);
  if (
    quote.request.departingTerminalId !== request.departingTerminalId ||
    quote.request.arrivingTerminalId !== request.arrivingTerminalId ||
    quote.request.tripDate !== request.tripDate ||
    !candidateSelections ||
    candidateSelections !== requestedSelections ||
    request.tripDate < freshness.validFrom ||
    request.tripDate > freshness.validThrough ||
    !freshness.sourceCacheFlushDate ||
    !Number.isFinite(freshness.fetchedAt)
  ) {
    return false;
  }
  const policy = validateFareCollectionPolicy(
    policyEntries,
    request.departingTerminalId,
    request.arrivingTerminalId,
    freshness.sourceCacheFlushDate,
    now
  );
  return (
    policy.ok &&
    policy.value.fareCollected &&
    policy.value.roundTrip === quote.request.roundTrip &&
    policy.value.policyVersion === freshness.policyVersion
  );
};

/** Express-independent public fare catalog/quote cache and fallback policy. */
export const createPublicFareQueryService = (
  dependencies: PublicFareQueryDependencies = {}
) => {
  const adapter = dependencies.adapter ?? createFareAdapter();
  const now = dependencies.now ?? (() => new Date());
  const policyEntries = dependencies.policyEntries ?? FARE_COLLECTION_POLICY;
  const catalogStore = dependencies.catalogStore ?? sequelizeFareCatalogStore;
  const quoteStore = dependencies.quoteStore ?? sequelizeFareQuoteStore;

  const getCatalog = async (
    input: FareTripRequest
  ): Promise<PublicFareCatalogOutcome> => {
    let cached: FareCatalogResult | undefined;
    try {
      cached = await catalogStore.find(input);
    } catch {
      // A database outage must not prevent a live official fare lookup.
    }
    if (cached && isUsableCachedResult(cached.freshness.fetchedAt, now())) {
      if (
        cacheAgeSeconds(cached.freshness.fetchedAt, now()) >=
        FARE_CACHE_FRESH_SECONDS
      ) {
        warmFareCatalogInBackground(adapter, catalogStore, input);
      }
      return cached.kind === "catalog"
        ? { catalog: cached, kind: "catalog" }
        : { kind: "no-fare", noFare: cached };
    }
    const result = await adapter.getCatalog(input);
    if (result.kind !== "unavailable") {
      try {
        await catalogStore.save(result);
      } catch {
        // Best-effort persistence must never suppress a current official result.
      }
    }
    if (result.kind === "catalog") {
      return { catalog: result, kind: "catalog" };
    }
    if (result.kind === "no-fare") {
      return { kind: "no-fare", noFare: result };
    }
    return { kind: "unavailable", reason: result.reason };
  };

  const getQuote = async (
    input: FareQuoteRequest
  ): Promise<PublicFareQuoteOutcome> => {
    const requestedSelections = canonicalFareSelections(input.lineItems);
    if (requestedSelections) {
      let candidates: FareQuote[] = [];
      try {
        candidates = (await quoteStore.findExact(input)) ?? [];
      } catch {
        // Fall through to the live official calculation on a cache failure.
      }
      const cached = candidates.find(
        (candidate) =>
          candidateIsExactAndEligible(candidate, input, policyEntries, now()) &&
          isUsableCachedResult(candidate.freshness.fetchedAt, now())
      );
      if (cached) {
        if (
          cacheAgeSeconds(cached.freshness.fetchedAt, now()) >=
          FARE_CACHE_FRESH_SECONDS
        ) {
          warmFareQuoteInBackground(adapter, quoteStore, input);
        }
        return { kind: "quote", quote: cached };
      }
    }
    const result = await adapter.getQuote(input);
    if (result.kind === "quote") {
      try {
        await quoteStore.save(result);
      } catch {
        // Best-effort cache persistence; serve the current upstream result.
      }
      return { kind: "quote", quote: result };
    }
    if (result.kind === "no-fare") {
      return { kind: "no-fare", noFare: result };
    }
    if (result.reason === "upstream-unavailable") {
      let candidates: FareQuote[];
      try {
        candidates = await quoteStore.findExact(input);
      } catch {
        return { kind: "unavailable", reason: result.reason };
      }
      const quote = candidates.find((candidate) =>
        candidateIsExactAndEligible(candidate, input, policyEntries, now())
      );
      if (quote) {
        return { kind: "stale", quote, staleAt: quote.freshness.fetchedAt };
      }
    }
    return { kind: "unavailable", reason: result.reason };
  };

  return { getCatalog, getQuote };
};
