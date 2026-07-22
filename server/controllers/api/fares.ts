import { Request, RequestHandler, Router } from "express";
import { MINUTE, rateLimit } from "express-rate-limit";
import type {
  FareCatalogApiResponse,
  FareCatalogResult,
  FareQuote,
  FareQuoteApiResponse,
  FareQuoteRequest,
  FareTripRequest,
  FareUnavailableResponse,
} from "shared/contracts/fares";
import {
  FARE_COLLECTION_POLICY,
  FareCollectionPolicy,
  validateFareCollectionPolicy,
} from "shared/lib/fareCollectionPolicy";

import {
  createFareAdapter,
  FareAdapter,
  FareUnavailable,
  WSDOT_FARE_CALCULATOR_URL,
} from "~/lib/wsf/fares";

import {
  warmFareCatalogInBackground,
  warmFareQuoteInBackground,
} from "../../lib/fareCache";
import {
  FARE_CACHE_FRESH_SECONDS,
  FARE_CACHE_STALE_SECONDS,
  FareCatalogStore,
  FareQuoteStore,
  sequelizeFareCatalogStore,
  sequelizeFareQuoteStore,
} from "../../lib/fares";

export interface FareRouterDependencies {
  adapter?: FareAdapter;
  catalogStore?: FareCatalogStore;
  now?: () => Date;
  policyEntries?: FareCollectionPolicy[];
  quoteStore?: FareQuoteStore;
  rateLimiter?: RequestHandler;
}

export const createFareRateLimiter = ({
  limit = 60,
  windowMs = MINUTE,
}: {
  limit?: number;
  windowMs?: number;
} = {}): RequestHandler =>
  rateLimit({
    identifier: "fares",
    legacyHeaders: false,
    limit,
    standardHeaders: "draft-8",
    windowMs,
  });

const isTripDate = (value: unknown): value is FareTripRequest["tripDate"] =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const asTripRequest = (value: unknown): FareTripRequest | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.departingTerminalId !== "string" ||
    !input.departingTerminalId ||
    typeof input.arrivingTerminalId !== "string" ||
    !input.arrivingTerminalId ||
    !isTripDate(input.tripDate)
  ) {
    return undefined;
  }
  // Collection mode is policy-owned; anonymous callers cannot choose it.
  return {
    arrivingTerminalId: input.arrivingTerminalId,
    departingTerminalId: input.departingTerminalId,
    roundTrip: false,
    tripDate: input.tripDate,
  };
};

const asQuoteRequest = (value: unknown): FareQuoteRequest | undefined => {
  const trip = asTripRequest(value);
  if (!trip || !value || typeof value !== "object") {
    return undefined;
  }
  const { lineItems } = value as Record<string, unknown>;
  if (!Array.isArray(lineItems)) {
    return undefined;
  }
  const normalized = lineItems.map((lineItem) => {
    if (!lineItem || typeof lineItem !== "object") {
      return undefined;
    }
    const entry = lineItem as Record<string, unknown>;
    return typeof entry.fareLineItemId === "number" &&
      typeof entry.quantity === "number"
      ? { fareLineItemId: entry.fareLineItemId, quantity: entry.quantity }
      : undefined;
  });
  return normalized.every(Boolean)
    ? { ...trip, lineItems: normalized as FareQuoteRequest["lineItems"] }
    : undefined;
};

const fromQuery = (request: Request): FareTripRequest | undefined =>
  asTripRequest({
    arrivingTerminalId: request.query.arrivingTerminalId,
    departingTerminalId: request.query.departingTerminalId,
    tripDate: request.query.tripDate,
  });

const unavailable = (
  reason: FareUnavailable["reason"] | "invalid-request"
): FareUnavailableResponse => ({
  calculatorUrl: WSDOT_FARE_CALCULATOR_URL,
  reason:
    reason === "invalid-request" || reason === "policy"
      ? reason
      : "unavailable",
  state: "unavailable",
});

/** Recheck cache-key equivalence at the API boundary before serving stale data. */
const canonicalSelections = (
  lineItems: FareQuoteRequest["lineItems"]
): string | undefined => {
  const quantities = new Map<number, number>();
  for (const { fareLineItemId, quantity } of lineItems) {
    if (
      !Number.isInteger(fareLineItemId) ||
      fareLineItemId <= 0 ||
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      return undefined;
    }
    if (quantity > 0) {
      quantities.set(
        fareLineItemId,
        (quantities.get(fareLineItemId) ?? 0) + quantity
      );
    }
  }
  const selections = [...quantities]
    .map(([fareLineItemId, quantity]) => ({ fareLineItemId, quantity }))
    .sort((first, second) => first.fareLineItemId - second.fareLineItemId);
  return selections.length ? JSON.stringify(selections) : undefined;
};

const candidateIsExactAndEligible = (
  quote: FareQuote,
  request: FareQuoteRequest,
  policyEntries: FareCollectionPolicy[],
  now: Date
): boolean => {
  const { freshness } = quote;
  const candidateSelections = canonicalSelections(quote.request.lineItems);
  const requestedSelections = canonicalSelections(request.lineItems);
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

const cacheAgeSeconds = (fetchedAt: number, now: Date): number =>
  Math.floor(now.getTime() / 1000) - fetchedAt;

const isUsableCachedResult = (fetchedAt: number, now: Date): boolean =>
  Number.isFinite(fetchedAt) &&
  cacheAgeSeconds(fetchedAt, now) >= 0 &&
  cacheAgeSeconds(fetchedAt, now) <= FARE_CACHE_STALE_SECONDS;

/** Anonymous server-only fare endpoint; the upstream key never crosses this boundary. */
export const createFareRouter = (
  dependencies: FareRouterDependencies = {}
): Router => {
  const router = Router();
  const adapter = dependencies.adapter ?? createFareAdapter();
  const now = dependencies.now ?? (() => new Date());
  const policyEntries = dependencies.policyEntries ?? FARE_COLLECTION_POLICY;
  const catalogStore = dependencies.catalogStore ?? sequelizeFareCatalogStore;
  const quoteStore = dependencies.quoteStore ?? sequelizeFareQuoteStore;

  router.use(dependencies.rateLimiter ?? createFareRateLimiter());

  router.get("/catalog", async (request, response) => {
    const input = fromQuery(request);
    if (!input) {
      return response.send(unavailable("invalid-request"));
    }
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
      const body: FareCatalogApiResponse =
        cached.kind === "catalog"
          ? { catalog: cached, state: "current" }
          : { noFare: cached, state: "no-fare" };
      return response.send(body);
    }
    const result = await adapter.getCatalog(input);
    if (result.kind !== "unavailable") {
      // Persist in the request path only for a cold miss; refreshes are async.
      try {
        await catalogStore.save(result);
      } catch {
        // Best-effort persistence must never suppress a current official result.
      }
    }
    let body: FareCatalogApiResponse;
    if (result.kind === "catalog") {
      body = { catalog: result, state: "current" };
    } else if (result.kind === "no-fare") {
      body = { noFare: result, state: "no-fare" };
    } else {
      body = unavailable(result.reason);
    }
    return response.send(body);
  });

  router.post("/quote", async (request, response) => {
    const input = asQuoteRequest(request.body);
    if (!input) {
      return response.send(unavailable("invalid-request"));
    }
    const requestedSelections = canonicalSelections(input.lineItems);
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
        const body: FareQuoteApiResponse = { quote: cached, state: "current" };
        return response.send(body);
      }
    }
    const result = await adapter.getQuote(input);
    if (result.kind === "quote") {
      // Caching cannot make a freshly calculated, valid quote unavailable.
      try {
        await quoteStore.save(result);
      } catch {
        // Best-effort cache persistence; serve the current upstream result.
      }
      const body: FareQuoteApiResponse = { quote: result, state: "current" };
      return response.send(body);
    }
    if (result.kind === "no-fare") {
      const body: FareQuoteApiResponse = { noFare: result, state: "no-fare" };
      return response.send(body);
    }
    // A stale value is permitted only after a true live upstream failure.
    if (result.reason === "upstream-unavailable") {
      let candidates: FareQuote[];
      try {
        candidates = await quoteStore.findExact(input);
      } catch {
        return response.send(unavailable(result.reason));
      }
      const quote = candidates.find((candidate) =>
        candidateIsExactAndEligible(candidate, input, policyEntries, now())
      );
      if (quote) {
        const body: FareQuoteApiResponse = {
          calculatorUrl: WSDOT_FARE_CALCULATOR_URL,
          quote,
          staleAt: quote.freshness.fetchedAt,
          state: "stale",
        };
        return response.send(body);
      }
    }
    return response.send(unavailable(result.reason));
  });

  return router;
};

export const fareRouter = createFareRouter();
