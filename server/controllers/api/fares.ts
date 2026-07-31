import { RequestHandler, Router } from "express";
import { MINUTE, rateLimit } from "express-rate-limit";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
  FareTripRequest,
  FareUnavailableResponse,
} from "shared/contracts/fares";
import type { FareCollectionPolicy } from "shared/lib/fareCollectionPolicy";

import type { FareCatalogStore, FareQuoteStore } from "~/lib/fares";
import {
  type FareAdapter,
  type FareUnavailable,
  WSDOT_FARE_CALCULATOR_URL,
} from "~/lib/wsf/fares";
import {
  createPublicFareQueryService,
  type PublicFareCatalogOutcome,
  type PublicFareQueryDependencies,
  type PublicFareQuoteOutcome,
} from "~/services/public/fares";

export interface FareRouterDependencies extends PublicFareQueryDependencies {
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

const catalogApiResponse = (
  result: PublicFareCatalogOutcome
): FareCatalogApiResponse => {
  if (result.kind === "catalog") {
    return { catalog: result.catalog, state: "current" };
  }
  if (result.kind === "no-fare") {
    return { noFare: result.noFare, state: "no-fare" };
  }
  return unavailable(result.reason);
};

const quoteApiResponse = (
  result: PublicFareQuoteOutcome
): FareQuoteApiResponse => {
  if (result.kind === "quote") {
    return { quote: result.quote, state: "current" };
  }
  if (result.kind === "no-fare") {
    return { noFare: result.noFare, state: "no-fare" };
  }
  if (result.kind === "stale") {
    return {
      calculatorUrl: WSDOT_FARE_CALCULATOR_URL,
      quote: result.quote,
      staleAt: result.staleAt,
      state: "stale",
    };
  }
  return unavailable(result.reason);
};

/** Anonymous server-only fare endpoint; the upstream key never crosses this boundary. */
export const createFareRouter = (
  dependencies: FareRouterDependencies = {}
): Router => {
  const router = Router();
  const publicFares = createPublicFareQueryService(dependencies);

  router.use(dependencies.rateLimiter ?? createFareRateLimiter());
  router.get("/catalog", async (request, response) => {
    const input = asTripRequest({
      arrivingTerminalId: request.query.arrivingTerminalId,
      departingTerminalId: request.query.departingTerminalId,
      tripDate: request.query.tripDate,
    });
    return response.send(
      input
        ? catalogApiResponse(await publicFares.getCatalog(input))
        : unavailable("invalid-request")
    );
  });
  router.post("/quote", async (request, response) => {
    const input = asQuoteRequest(request.body);
    return response.send(
      input
        ? quoteApiResponse(await publicFares.getQuote(input))
        : unavailable("invalid-request")
    );
  });

  return router;
};

export const fareRouter = createFareRouter();
