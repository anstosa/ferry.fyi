import type { FareQuoteRequest, FareTripRequest } from "shared/contracts/fares";
import { FARE_COLLECTION_POLICY } from "shared/lib/fareCollectionPolicy";

import {
  FareCatalogStore,
  FareQuoteStore,
  sequelizeFareCatalogStore,
} from "./fares";
import { createFareAdapter, FareAdapter } from "./wsf/fares";

const inFlight = new Set<string>();
const FARE_WARM_CONCURRENCY = 3;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const keyFor = (prefix: string, request: FareTripRequest): string =>
  `${prefix}:${request.departingTerminalId}:${request.arrivingTerminalId}:${request.tripDate}`;

/** Coalesce concurrent refreshes so a busy cache never fans out to WSDOT. */
const warm = (key: string, task: () => Promise<void>): Promise<void> => {
  if (inFlight.has(key)) {
    return Promise.resolve();
  }
  inFlight.add(key);
  return task()
    .catch(() => {
      // A cached result remains usable when WSDOT is temporarily unavailable.
    })
    .finally(() => inFlight.delete(key));
};

export const warmFareCatalogInBackground = (
  adapter: FareAdapter,
  store: FareCatalogStore,
  request: FareTripRequest
): void => {
  warmFareCatalog(adapter, store, request);
};

const warmFareCatalog = (
  adapter: FareAdapter,
  store: FareCatalogStore,
  request: FareTripRequest
): Promise<void> =>
  warm(keyFor("catalog", request), async () => {
    const result = await adapter.getCatalog(request);
    if (result.kind !== "unavailable") {
      await store.save(result);
    }
  });

export const warmFareQuoteInBackground = (
  adapter: FareAdapter,
  store: FareQuoteStore,
  request: FareQuoteRequest
): void => {
  const selections = request.lineItems
    .map(({ fareLineItemId, quantity }) => `${fareLineItemId}x${quantity}`)
    .sort()
    .join(",");
  warm(`${keyFor("quote", request)}:${selections}`, async () => {
    const result = await adapter.getQuote(request);
    if (result.kind === "quote") {
      await store.save(result);
    }
  });
};

/** Return the current ferry service date in the WSF/Pacific timezone. */
export const currentFareTripDate = (
  now = new Date()
): FareTripRequest["tripDate"] => {
  const fields = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    fields.find((field) => field.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}` as FareTripRequest["tripDate"];
};

const fareCatalogRequestsForDate = (
  tripDate: FareTripRequest["tripDate"]
): FareTripRequest[] =>
  FARE_COLLECTION_POLICY.filter(({ fareCollected }) => fareCollected).map(
    ({ arrivingTerminalId, departingTerminalId, roundTrip }) => ({
      arrivingTerminalId,
      departingTerminalId,
      roundTrip,
      tripDate,
    })
  );

/** Warm every fare-collection direction once for the current ferry service day. */
export const warmTodayFareCatalogs = async (
  now = new Date(),
  dependencies: {
    adapter?: FareAdapter;
    store?: FareCatalogStore;
  } = {}
): Promise<void> => {
  const adapter = dependencies.adapter ?? createFareAdapter();
  const store = dependencies.store ?? sequelizeFareCatalogStore;
  const requests = fareCatalogRequestsForDate(currentFareTripDate(now));
  for (let index = 0; index < requests.length; index += FARE_WARM_CONCURRENCY) {
    await Promise.all(
      requests
        .slice(index, index + FARE_WARM_CONCURRENCY)
        .map((request) => warmFareCatalog(adapter, store, request))
    );
  }
};

/** Refresh a bounded batch each hour, rather than querying WSDOT per visitor. */
export const warmDueFareCatalogs = async (
  now = new Date(),
  dependencies: {
    adapter?: FareAdapter;
    store?: FareCatalogStore;
  } = {}
): Promise<void> => {
  const adapter = dependencies.adapter ?? createFareAdapter();
  const store = dependencies.store ?? sequelizeFareCatalogStore;
  const before = Math.floor(now.getTime() / 1000) - 6 * 60 * 60;
  const requests = await store.findRefreshCandidates(before, 12);
  for (const request of requests) {
    warmFareCatalogInBackground(adapter, store, request);
  }
};
