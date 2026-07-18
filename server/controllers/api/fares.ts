import { Request, Router } from "express";
import type {
  FareCatalogApiResponse,
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

import { FareQuoteStore, sequelizeFareQuoteStore } from "~/lib/fares";
import {
  createFareAdapter,
  FareAdapter,
  FareUnavailable,
  WSDOT_FARE_CALCULATOR_URL,
} from "~/lib/wsf/fares";

export interface FareRouterDependencies {
  adapter?: FareAdapter;
  now?: () => Date;
  policyEntries?: FareCollectionPolicy[];
  quoteStore?: FareQuoteStore;
}

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

const candidateIsExactAndEligible = (
  quote: FareQuote,
  request: FareQuoteRequest,
  policyEntries: FareCollectionPolicy[],
  now: Date
): boolean => {
  const { freshness } = quote;
  if (
    quote.request.departingTerminalId !== request.departingTerminalId ||
    quote.request.arrivingTerminalId !== request.arrivingTerminalId ||
    quote.request.tripDate !== request.tripDate ||
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

/** Anonymous server-only fare endpoint; the upstream key never crosses this boundary. */
export const createFareRouter = (
  dependencies: FareRouterDependencies = {}
): Router => {
  const router = Router();
  const adapter = dependencies.adapter ?? createFareAdapter();
  const now = dependencies.now ?? (() => new Date());
  const policyEntries = dependencies.policyEntries ?? FARE_COLLECTION_POLICY;
  const quoteStore = dependencies.quoteStore ?? sequelizeFareQuoteStore;

  router.get("/catalog", async (request, response) => {
    const input = fromQuery(request);
    if (!input) {
      return response.send(unavailable("invalid-request"));
    }
    const result = await adapter.getCatalog(input);
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
    const result = await adapter.getQuote(input);
    if (result.kind === "quote") {
      await quoteStore.save(result);
      const body: FareQuoteApiResponse = { quote: result, state: "current" };
      return response.send(body);
    }
    if (result.kind === "no-fare") {
      const body: FareQuoteApiResponse = { noFare: result, state: "no-fare" };
      return response.send(body);
    }
    // A stale value is permitted only after a true live upstream failure.
    if (result.reason === "upstream-unavailable") {
      const candidates = await quoteStore.findExact(input);
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
