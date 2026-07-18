/** A calendar date accepted by the WSDOT fares REST API. */
export type FareTripDate = `${number}-${number}-${number}`;

/** Route and date inputs shared by fare catalog and quote requests. */
export interface FareTripRequest {
  arrivingTerminalId: string;
  departingTerminalId: string;
  roundTrip: boolean;
  tripDate: FareTripDate;
}

/** A requested quantity of a fare line item. */
export interface FareLineItemSelection {
  fareLineItemId: number;
  quantity: number;
}

/** Inputs required to calculate a price quote. */
export interface FareQuoteRequest extends FareTripRequest {
  lineItems: FareLineItemSelection[];
}

/** A fare available for a route, direction, and date. */
export interface FareLineItem {
  amount: number;
  category: string;
  directionIndependent: boolean;
  id: number;
  label: string;
}

/** A WSDOT-provided total for a selected set of fare line items. */
export interface FareTotal {
  amount: number;
  briefDescription: string;
  description: string;
  type: "depart" | "either" | "return" | "total";
}

/** Source timing retained with fare responses instead of inferring freshness. */
export interface FareFreshness {
  /** Epoch seconds when Ferry FYI most recently acquired the source data. */
  fetchedAt: number;
  /** WSDOT cache marker, if supplied by its cacheflushdate endpoint. */
  sourceCacheFlushDate: string | null;
}

/** A catalog of prices collected for a route and travel date. */
export interface FareCatalog {
  collectionDescription: string | null;
  fares: FareLineItem[];
  freshness: FareFreshness;
  kind: "catalog";
  request: FareTripRequest;
}

/** A priced result for a requested collection of fare line items. */
export interface FareQuote {
  freshness: FareFreshness;
  kind: "quote";
  request: FareQuoteRequest;
  totals: FareTotal[];
}

/** A route/direction that does not collect a fare at its departing terminal. */
export interface FareNoFare {
  freshness: FareFreshness;
  kind: "no-fare";
  message: string | null;
  request: FareTripRequest;
}

export type FareCatalogResult = FareCatalog | FareNoFare;
export type FareQuoteResult = FareQuote | FareNoFare;

/**
 * Raw WSDOT fare API line item shape.
 *
 * Source: https://www.wsdot.wa.gov/ferries/api/fares/documentation/rest.html
 */
export interface WsdotFareLineItemResponse {
  Amount: number;
  Category: string;
  DirectionIndependent: boolean;
  FareLineItem: string;
  FareLineItemID: number;
}

/** Raw WSDOT fare API totals shape. */
export interface WsdotFareTotalResponse {
  Amount: number;
  BriefDescription: string;
  Description: string;
  TotalType: "Depart" | "Either" | "Return" | "Total";
}

export type FareSourceValidation<T> =
  | { errors: string[]; ok: false }
  | { ok: true; value: T };

export interface WsdotFareEndpointCapability {
  pathTemplate: string;
  requiresApiAccessCode: boolean;
  response: "date" | "fare-line-items" | "fare-totals";
}

/**
 * Machine-readable capabilities deliberately omit the WSDOT credential value.
 * `WSDOT_API_KEY` belongs exclusively to server configuration.
 */
export interface WsdotFareCapabilityMetadata {
  credential: {
    environmentKey: "WSDOT_API_KEY";
    exposure: "server-only";
    queryParameter: "apiaccesscode";
  };
  endpoints: {
    cacheFlushDate: WsdotFareEndpointCapability;
    fareLineItems: WsdotFareEndpointCapability;
    fareTotals: WsdotFareEndpointCapability;
  };
  source: "wsdot-fares-rest";
}

export const WSDOT_FARE_API_CAPABILITIES: WsdotFareCapabilityMetadata = {
  credential: {
    environmentKey: "WSDOT_API_KEY",
    exposure: "server-only",
    queryParameter: "apiaccesscode",
  },
  endpoints: {
    cacheFlushDate: {
      pathTemplate: "/ferries/api/fares/rest/cacheflushdate",
      requiresApiAccessCode: false,
      response: "date",
    },
    fareLineItems: {
      pathTemplate:
        "/ferries/api/fares/rest/farelineitems/{tripDate}/{departingTerminalId}/{arrivingTerminalId}/{roundTrip}",
      requiresApiAccessCode: true,
      response: "fare-line-items",
    },
    fareTotals: {
      pathTemplate:
        "/ferries/api/fares/rest/faretotals/{tripDate}/{departingTerminalId}/{arrivingTerminalId}/{roundTrip}/{fareLineItemIds}/{quantities}",
      requiresApiAccessCode: true,
      response: "fare-totals",
    },
  },
  source: "wsdot-fares-rest",
};

export const WSDOT_FARE_SERVER_ENV_KEYS = ["WSDOT_API_KEY"] as const;
