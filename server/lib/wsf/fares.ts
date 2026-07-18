import {
  FareCatalog,
  FareCatalogResult,
  FareLineItem,
  FareLineItemSelection,
  FareNoFare,
  FareQuote,
  FareQuoteRequest,
  FareQuoteResult,
  FareSourceValidation,
  FareTotal,
  FareTripRequest,
  WsdotFareTotalResponse,
} from "shared/contracts/fares";
import {
  FARE_COLLECTION_POLICY,
  FareCollectionPolicy,
  validateFareCollectionPolicy,
} from "shared/lib/fareCollectionPolicy";
import {
  validateWsdotFareLineItems,
  validateWsdotFareTotals,
} from "shared/lib/fares";

import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";

const FARES_API = "https://www.wsdot.wa.gov/ferries/api/fares/rest";

/** The public WSDOT calculator remains the safe fallback for unavailable data. */
export const WSDOT_FARE_CALCULATOR_URL = "https://wsdot.wa.gov/ferries/fares/";

export type FareUnavailableReason =
  | "generation-race"
  | "invalid-request"
  | "invalid-source"
  | "policy"
  | "upstream-unavailable";

export interface FareUnavailable {
  calculatorUrl: string;
  kind: "unavailable";
  reason: FareUnavailableReason;
  request: FareTripRequest;
}

export type FareAdapterCatalogResult = FareCatalogResult | FareUnavailable;
export type FareAdapterQuoteResult = FareQuoteResult | FareUnavailable;

export interface FareAdapterDependencies {
  now?: () => Date;
  policyEntries?: FareCollectionPolicy[];
  policyValidator?: (
    departingTerminalId: string,
    arrivingTerminalId: string,
    generation: string,
    at: Date
  ) => FareSourceValidation<FareCollectionPolicy>;
  request?: <T>(path: string) => Promise<T | undefined>;
}

export interface FareAdapter {
  getCatalog: (request: FareTripRequest) => Promise<FareAdapterCatalogResult>;
  getQuote: (request: FareQuoteRequest) => Promise<FareAdapterQuoteResult>;
}

interface ValidatedContext {
  freshness: FareCatalog["freshness"];
  policy: FareCollectionPolicy;
}

type AttemptResult<T> =
  | { generationChanged: true }
  | { result: T; generationChanged: false };

const unavailable = (
  request: FareTripRequest,
  reason: FareUnavailableReason
): FareUnavailable => ({
  calculatorUrl: WSDOT_FARE_CALCULATOR_URL,
  kind: "unavailable",
  reason,
  request,
});

const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const isExactTerminalId = (value: unknown, terminalId: string): boolean =>
  (typeof value === "string" || typeof value === "number") &&
  String(value) === terminalId;

const findDateRange = (
  value: WSF.FareValidDateRangeResponse | undefined
): { end: string; start: string } | undefined => {
  if (!value || typeof value !== "object") {
    return;
  }
  const start = value.StartDate ?? value.DateFrom;
  const end = value.EndDate ?? value.DateThru;
  return typeof start === "string" && typeof end === "string"
    ? { end, start }
    : undefined;
};

const dateIsInRange = (
  tripDate: string,
  range: { end: string; start: string }
): boolean => {
  const start = range.start.slice(0, 10);
  const end = range.end.slice(0, 10);
  return (
    isDate(tripDate) &&
    isDate(start) &&
    isDate(end) &&
    tripDate >= start &&
    tripDate <= end
  );
};

const normalizeSelections = (
  lineItems: FareLineItemSelection[]
): FareSourceValidation<FareLineItemSelection[]> => {
  const quantities = new Map<number, number>();
  for (const selection of lineItems) {
    if (
      !Number.isInteger(selection.fareLineItemId) ||
      selection.fareLineItemId <= 0 ||
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 0
    ) {
      return {
        errors: [
          "Fare selections require positive IDs and non-negative integer quantities.",
        ],
        ok: false,
      };
    }
    if (selection.quantity > 0) {
      quantities.set(
        selection.fareLineItemId,
        (quantities.get(selection.fareLineItemId) ?? 0) + selection.quantity
      );
    }
  }
  return {
    ok: true,
    value: [...quantities]
      .map(([fareLineItemId, quantity]) => ({ fareLineItemId, quantity }))
      .sort((a, b) => a.fareLineItemId - b.fareLineItemId),
  };
};

const mapLineItems = (value: unknown): FareSourceValidation<FareLineItem[]> => {
  const valid = validateWsdotFareLineItems(value);
  if (!valid.ok) {
    return valid;
  }
  return {
    ok: true,
    value: valid.value.map((item) => ({
      amount: item.Amount,
      category: item.Category,
      directionIndependent: item.DirectionIndependent,
      id: item.FareLineItemID,
      label: item.FareLineItem,
    })),
  };
};

const mapTotals = (value: unknown): FareSourceValidation<FareTotal[]> => {
  const valid = validateWsdotFareTotals(value);
  if (!valid.ok) {
    return valid;
  }
  const typeMap: Record<
    WsdotFareTotalResponse["TotalType"],
    FareTotal["type"]
  > = {
    Depart: "depart",
    Either: "either",
    Return: "return",
    Total: "total",
  };
  const totals = valid.value.map((total) => ({
    amount: total.Amount,
    briefDescription: total.BriefDescription,
    description: total.Description,
    type: typeMap[total.TotalType],
  }));
  const totalRows = totals.filter((total) => total.type === "total");
  return totalRows.length === 1
    ? { ok: true, value: totals }
    : {
        errors: ["WSDOT fare totals must contain exactly one total row."],
        ok: false,
      };
};

/**
 * Builds the server-only WSDOT fare adapter. Every live response is guarded by
 * an initial and final cache-flush generation; one changed generation retries
 * the whole operation and a second changed generation is unavailable.
 */
export const createFareAdapter = (
  dependencies: FareAdapterDependencies = {}
): FareAdapter => {
  const request = dependencies.request ?? wsfRequest;
  const policyEntries = dependencies.policyEntries ?? FARE_COLLECTION_POLICY;
  const now = dependencies.now ?? (() => new Date());
  const policyValidator =
    dependencies.policyValidator ??
    ((
      departingTerminalId: string,
      arrivingTerminalId: string,
      generation: string,
      at: Date
    ) =>
      validateFareCollectionPolicy(
        policyEntries,
        departingTerminalId,
        arrivingTerminalId,
        generation,
        at
      ));

  const fetchContext = async (
    input: FareTripRequest,
    generation: string
  ): Promise<
    { context: ValidatedContext } | { reason: FareUnavailableReason }
  > => {
    const validRangeResponse = await request<WSF.FareValidDateRangeResponse>(
      `${FARES_API}/validdaterange`
    );
    if (!validRangeResponse) {
      return { reason: "upstream-unavailable" };
    }
    const validRange = findDateRange(validRangeResponse);
    if (!validRange || !dateIsInRange(input.tripDate, validRange)) {
      return { reason: "invalid-source" };
    }

    const terminals = await request<WSF.FareTerminalResponse[]>(
      `${FARES_API}/terminals/${input.tripDate}`
    );
    if (!terminals) {
      return { reason: "upstream-unavailable" };
    }
    if (
      !Array.isArray(terminals) ||
      !terminals.some((terminal) =>
        isExactTerminalId(terminal?.TerminalID, input.departingTerminalId)
      ) ||
      !terminals.some((terminal) =>
        isExactTerminalId(terminal?.TerminalID, input.arrivingTerminalId)
      )
    ) {
      return { reason: "invalid-source" };
    }

    const mates = await request<WSF.FareTerminalMateResponse[]>(
      `${FARES_API}/terminalmates/${input.tripDate}/${input.departingTerminalId}`
    );
    if (!mates) {
      return { reason: "upstream-unavailable" };
    }
    if (
      !Array.isArray(mates) ||
      !mates.some(
        (mate) =>
          isExactTerminalId(mate?.TerminalID, input.arrivingTerminalId) ||
          isExactTerminalId(mate?.ArrivingTerminalID, input.arrivingTerminalId)
      )
    ) {
      return { reason: "invalid-source" };
    }

    const combos = await request<WSF.FareTerminalComboResponse[]>(
      `${FARES_API}/terminalcomboverbose/${input.tripDate}`
    );
    if (!combos) {
      return { reason: "upstream-unavailable" };
    }
    // Exact IDs come from terminalcomboverbose; descriptions are never policy.
    if (
      !Array.isArray(combos) ||
      !combos.some(
        (combo) =>
          isExactTerminalId(
            combo?.DepartingTerminalID,
            input.departingTerminalId
          ) &&
          isExactTerminalId(combo?.ArrivingTerminalID, input.arrivingTerminalId)
      )
    ) {
      return { reason: "invalid-source" };
    }

    // Policy, not provider description/empty response, declares collection mode.
    const policy = policyValidator(
      input.departingTerminalId,
      input.arrivingTerminalId,
      generation,
      now()
    );
    if (!policy.ok) {
      return { reason: "policy" };
    }
    return {
      context: {
        freshness: {
          fetchedAt: Math.floor(now().getTime() / 1000),
          policyVersion: policy.value.policyVersion,
          sourceCacheFlushDate: generation,
          validFrom: validRange.start.slice(
            0,
            10
          ) as FareTripRequest["tripDate"],
          validThrough: validRange.end.slice(
            0,
            10
          ) as FareTripRequest["tripDate"],
        },
        policy: policy.value,
      },
    };
  };

  const readGeneration = async (): Promise<string | undefined> => {
    const generation = await request<string>(`${FARES_API}/cacheflushdate`);
    return typeof generation === "string" && generation.length > 0
      ? generation
      : undefined;
  };

  const attemptCatalog = async (
    input: FareTripRequest
  ): Promise<AttemptResult<FareAdapterCatalogResult>> => {
    const g1 = await readGeneration();
    if (!g1) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    const contextResult = await fetchContext(input, g1);
    if (!("context" in contextResult)) {
      return {
        generationChanged: false,
        result: unavailable(input, contextResult.reason),
      };
    }
    const { context } = contextResult;
    if (!context.policy.fareCollected) {
      const g2 = await readGeneration();
      if (!g2) {
        return {
          generationChanged: false,
          result: unavailable(input, "upstream-unavailable"),
        };
      }
      if (g2 !== g1) {
        return { generationChanged: true };
      }
      const result: FareNoFare = {
        freshness: context.freshness,
        kind: "no-fare",
        message: context.policy.noFareMessage ?? null,
        request: { ...input, roundTrip: context.policy.roundTrip },
        sourceUrl: context.policy.noFareSourceUrl ?? null,
      };
      return { generationChanged: false, result };
    }
    const itemsResponse = await request<unknown>(
      `${FARES_API}/farelineitems/${input.tripDate}/${input.departingTerminalId}/${input.arrivingTerminalId}/${context.policy.roundTrip}`
    );
    if (itemsResponse === undefined) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    const items = mapLineItems(itemsResponse);
    if (!items.ok) {
      return {
        generationChanged: false,
        result: unavailable(input, "invalid-source"),
      };
    }
    const g2 = await readGeneration();
    if (!g2) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    if (g2 !== g1) {
      return { generationChanged: true };
    }
    const result: FareCatalog = {
      collectionDescription: null,
      fares: items.value,
      freshness: context.freshness,
      kind: "catalog",
      request: { ...input, roundTrip: context.policy.roundTrip },
    };
    return { generationChanged: false, result };
  };

  const getCatalog = async (
    input: FareTripRequest
  ): Promise<FareAdapterCatalogResult> => {
    if (
      !isDate(input.tripDate) ||
      !input.departingTerminalId ||
      !input.arrivingTerminalId
    ) {
      return unavailable(input, "invalid-request");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await attemptCatalog(input);
      if (!result.generationChanged) {
        return result.result;
      }
    }
    return unavailable(input, "generation-race");
  };

  const attemptQuote = async (
    input: FareQuoteRequest
  ): Promise<AttemptResult<FareAdapterQuoteResult>> => {
    const g1 = await readGeneration();
    if (!g1) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    const contextResult = await fetchContext(input, g1);
    if (!("context" in contextResult)) {
      return {
        generationChanged: false,
        result: unavailable(input, contextResult.reason),
      };
    }
    const { context } = contextResult;
    if (!context.policy.fareCollected) {
      const g2 = await readGeneration();
      if (!g2) {
        return {
          generationChanged: false,
          result: unavailable(input, "upstream-unavailable"),
        };
      }
      if (g2 !== g1) {
        return { generationChanged: true };
      }
      const result: FareNoFare = {
        freshness: context.freshness,
        kind: "no-fare",
        message: context.policy.noFareMessage ?? null,
        request: { ...input, roundTrip: context.policy.roundTrip },
        sourceUrl: context.policy.noFareSourceUrl ?? null,
      };
      return { generationChanged: false, result };
    }

    const normalized = normalizeSelections(input.lineItems);
    if (!normalized.ok || normalized.value.length === 0) {
      return {
        generationChanged: false,
        result: unavailable(input, "invalid-request"),
      };
    }
    const catalogResponse = await request<unknown>(
      `${FARES_API}/farelineitems/${input.tripDate}/${input.departingTerminalId}/${input.arrivingTerminalId}/${context.policy.roundTrip}`
    );
    if (catalogResponse === undefined) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    const catalog = mapLineItems(catalogResponse);
    if (
      !catalog.ok ||
      !normalized.value.every((item) =>
        catalog.value.some((fare) => fare.id === item.fareLineItemId)
      )
    ) {
      return {
        generationChanged: false,
        result: unavailable(input, "invalid-source"),
      };
    }
    const ids = normalized.value.map((item) => item.fareLineItemId).join(",");
    const quantities = normalized.value.map((item) => item.quantity).join(",");
    const totalsResponse = await request<unknown>(
      `${FARES_API}/faretotals/${input.tripDate}/${input.departingTerminalId}/${input.arrivingTerminalId}/${context.policy.roundTrip}/${ids}/${quantities}`
    );
    if (totalsResponse === undefined) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    const totals = mapTotals(totalsResponse);
    if (!totals.ok) {
      return {
        generationChanged: false,
        result: unavailable(input, "invalid-source"),
      };
    }
    const g2 = await readGeneration();
    if (!g2) {
      return {
        generationChanged: false,
        result: unavailable(input, "upstream-unavailable"),
      };
    }
    if (g2 !== g1) {
      return { generationChanged: true };
    }
    const result: FareQuote = {
      freshness: context.freshness,
      kind: "quote",
      request: {
        ...input,
        lineItems: normalized.value,
        roundTrip: context.policy.roundTrip,
      },
      totals: totals.value,
    };
    return { generationChanged: false, result };
  };

  const getQuote = async (
    input: FareQuoteRequest
  ): Promise<FareAdapterQuoteResult> => {
    if (
      !isDate(input.tripDate) ||
      !input.departingTerminalId ||
      !input.arrivingTerminalId
    ) {
      return unavailable(input, "invalid-request");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await attemptQuote(input);
      if (!result.generationChanged) {
        return result.result;
      }
    }
    return unavailable(input, "generation-race");
  };

  return { getCatalog, getQuote };
};

const defaultFareAdapter = createFareAdapter();

export const getFareCatalog = defaultFareAdapter.getCatalog;
export const getFareQuote = defaultFareAdapter.getQuote;
