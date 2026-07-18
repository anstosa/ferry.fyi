import { DateTime } from "luxon";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
} from "shared/contracts/fares";
import type { Terminal } from "shared/contracts/terminals";

import { get, post } from "~/lib/api";

const getCatalogPath = (
  departingTerminalId: string,
  arrivingTerminalId: string,
  tripDate: string
): string =>
  `/fares/catalog?${new URLSearchParams({
    arrivingTerminalId,
    departingTerminalId,
    tripDate,
  }).toString()}`;

/** Fetch the fare catalog once; unavailable responses are a deliberate UI state. */
export const getFareCatalog = (
  terminal: Terminal,
  mate: Terminal,
  date: DateTime = DateTime.local()
): Promise<FareCatalogApiResponse> =>
  get<FareCatalogApiResponse>(
    getCatalogPath(terminal.id, mate.id, date.toISODate() ?? "")
  );

/** Request a server-validated quote for the selected official catalog items. */
export const getFareQuote = (
  request: FareQuoteRequest
): Promise<FareQuoteApiResponse> => post<FareQuoteApiResponse>("/fares/quote", request);

export const getFareCatalogUrl = getCatalogPath;
