import type {
  FareCatalog,
  FareCatalogResult,
  FareDefaultRate,
  FareDefaultRateComparison,
  FareDefaultRates,
  FareLineItemSelection,
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
  getDefaultFareSelections,
  getQuotedFareRates,
} from "shared/lib/fareDefaults";

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
import logger from "../../lib/logger";
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
  | { catalog: FareCatalog; defaultRates?: FareDefaultRates; kind: "catalog" }
  | { defaultRates?: FareDefaultRates; kind: "no-fare"; noFare: FareNoFare }
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

// build an unavailable comparison
const unavailableRateComparison = (): FareDefaultRateComparison => ({
  oneWay: null,
  roundTrip: null,
});

// retain only summaries with evidence
const hasPublishedRate = (rates: FareDefaultRates): boolean =>
  rates.passenger.oneWay !== null ||
  rates.passenger.roundTrip !== null ||
  rates.standardVehicle.oneWay !== null ||
  rates.standardVehicle.roundTrip !== null;

// bind defaults to known catalog ids
const selectionsMatchCatalog = (
  catalog: FareCatalog,
  selections: FareLineItemSelection[]
): boolean => {
  const canonical = canonicalFareSelections(selections);
  return (
    canonical !== undefined &&
    selections.every((selection) =>
      catalog.fares.some((fare) => fare.id === selection.fareLineItemId)
    )
  );
};

// require exact quote request echoes
const quoteMatchesCatalogSelection = (
  quote: FareQuote,
  catalog: FareCatalog,
  selections: FareLineItemSelection[]
): boolean => {
  const expectedSelections = canonicalFareSelections(selections);
  const quotedSelections = canonicalFareSelections(quote.request.lineItems);
  return (
    expectedSelections !== undefined &&
    expectedSelections === quotedSelections &&
    quote.request.arrivingTerminalId === catalog.request.arrivingTerminalId &&
    quote.request.departingTerminalId === catalog.request.departingTerminalId &&
    quote.request.roundTrip === catalog.request.roundTrip &&
    quote.request.tripDate === catalog.request.tripDate
  );
};

// flatten only a matching current or stale quote
const ratesFromQuote = (
  outcome: PublicFareQuoteOutcome,
  catalog: FareCatalog,
  selections: FareLineItemSelection[]
): FareDefaultRateComparison => {
  // only exact current or stale quotes can publish a rate
  if (outcome.kind !== "quote" && outcome.kind !== "stale") {
    return unavailableRateComparison();
  }
  if (!quoteMatchesCatalogSelection(outcome.quote, catalog, selections)) {
    return unavailableRateComparison();
  }
  return getQuotedFareRates(
    outcome.quote,
    outcome.kind === "stale" ? "stale" : "current"
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
  const activeDefaultRateLookups = new Map<
    string,
    Promise<FareDefaultRates | undefined>
  >();

  // bind shared work to the exact request and producer generation
  const defaultRatesLookupKey = (
    outcome: PublicFareCatalogOutcome,
    input: FareTripRequest
  ): string | undefined => {
    // unavailable outcomes never start enrichment work
    if (outcome.kind === "unavailable") {
      return undefined;
    }
    const producer =
      outcome.kind === "catalog" ? outcome.catalog : outcome.noFare;
    // serialize exact route and date inputs
    const requestKey = (request: FareTripRequest) => [
      request.departingTerminalId,
      request.arrivingTerminalId,
      request.roundTrip,
      request.tripDate,
    ];
    // include both canonical public choices in catalog identity
    const selectionKeys =
      outcome.kind === "catalog"
        ? (["passenger", "standardVehicle"] as const).map((category) => {
            const selections = getDefaultFareSelections(
              outcome.catalog.fares,
              category
            );
            return selections ? canonicalFareSelections(selections) : null;
          })
        : [null, null];
    return JSON.stringify([
      requestKey(input),
      outcome.kind,
      requestKey(producer.request),
      [
        producer.freshness.fetchedAt,
        producer.freshness.sourceCacheFlushDate,
        producer.freshness.validFrom,
        producer.freshness.validThrough,
        producer.freshness.policyVersion,
      ],
      selectionKeys,
    ]);
  };

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
        const age = cacheAgeSeconds(cached.freshness.fetchedAt, now());
        // warm aged usable quotes without blocking the response
        if (age >= FARE_CACHE_FRESH_SECONDS) {
          warmFareQuoteInBackground(adapter, quoteStore, input);
          return {
            kind: "stale",
            quote: cached,
            staleAt: cached.freshness.fetchedAt,
          };
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

  const getCatalogDefaultRates = async (
    catalog: FareCatalog
  ): Promise<FareDefaultRates> => {
    // price one exact public default selection
    const getComparison = async (
      category: "passenger" | "standardVehicle"
    ): Promise<FareDefaultRateComparison> => {
      const selections = getDefaultFareSelections(catalog.fares, category);
      // an unknown or incomplete catalog selection stays unavailable
      if (!selections || !selectionsMatchCatalog(catalog, selections)) {
        return unavailableRateComparison();
      }
      let quoteOutcome: PublicFareQuoteOutcome;
      try {
        quoteOutcome = await getQuote({
          ...catalog.request,
          lineItems: selections,
        });
      } catch {
        logger.warn("Default fare rate lookup failed", {
          arrivingTerminalId: catalog.request.arrivingTerminalId,
          category,
          departingTerminalId: catalog.request.departingTerminalId,
          tripDate: catalog.request.tripDate,
        });
        return unavailableRateComparison();
      }
      return ratesFromQuote(quoteOutcome, catalog, selections);
    };
    const [passenger, standardVehicle] = await Promise.all([
      getComparison("passenger"),
      getComparison("standardVehicle"),
    ]);
    return { passenger, standardVehicle };
  };

  // calculate fixed public rates without exposing quote inputs
  const calculateDefaultRates = async (
    outcome: PublicFareCatalogOutcome,
    input: FareTripRequest
  ): Promise<FareDefaultRates | undefined> => {
    // unavailable catalogs cannot support fixed public rates
    if (outcome.kind === "unavailable") {
      return undefined;
    }
    if (outcome.kind === "catalog") {
      const rates = await getCatalogDefaultRates(outcome.catalog);
      return hasPublishedRate(rates) ? rates : undefined;
    }
    const noFareRate: FareDefaultRate = {
      amount: 0,
      freshness: outcome.noFare.freshness,
      state: "no-fare",
    };
    let reverseRates: FareDefaultRates | undefined;
    try {
      const reverse = await getCatalog({
        arrivingTerminalId: input.departingTerminalId,
        departingTerminalId: input.arrivingTerminalId,
        roundTrip: false,
        tripDate: input.tripDate,
      });
      // only a priced reverse catalog can provide an exact round-trip total
      if (reverse.kind === "catalog") {
        reverseRates = await getCatalogDefaultRates(reverse.catalog);
      }
    } catch {
      // report only inert request context without provider error data
      logger.warn("Default fare reverse lookup failed", {
        arrivingTerminalId: input.departingTerminalId,
        category: "reverseCatalog",
        departingTerminalId: input.arrivingTerminalId,
        tripDate: input.tripDate,
      });
    }
    return {
      passenger: {
        oneWay: noFareRate,
        roundTrip: reverseRates?.passenger.roundTrip ?? null,
      },
      standardVehicle: {
        oneWay: noFareRate,
        roundTrip: reverseRates?.standardVehicle.roundTrip ?? null,
      },
    };
  };

  // coalesce only identical in-flight public enrichment work
  const getDefaultRates = async (
    outcome: PublicFareCatalogOutcome,
    input: FareTripRequest
  ): Promise<FareDefaultRates | undefined> => {
    const key = defaultRatesLookupKey(outcome, input);
    // unavailable outcomes remain unenriched
    if (!key) {
      return undefined;
    }
    const active = activeDefaultRateLookups.get(key);
    // concurrent callers share the active calculation
    if (active) {
      return await active;
    }
    const pending = calculateDefaultRates(outcome, input).finally(() => {
      // never remove a newer calculation for the same key
      if (activeDefaultRateLookups.get(key) === pending) {
        activeDefaultRateLookups.delete(key);
      }
    });
    activeDefaultRateLookups.set(key, pending);
    return await pending;
  };

  return { getCatalog, getDefaultRates, getQuote };
};
