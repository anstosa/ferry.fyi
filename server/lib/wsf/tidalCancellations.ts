import { JSDOM } from "jsdom";
import { DateTime } from "luxon";

const API_TIDAL_CANCELLATIONS =
  "https://wsdot.com/ferries/schedule/AddCancelBySimpleRoute.aspx?routeid=8";
const COUPEVILLE_TERMINAL_ID = "11";
const PORT_TOWNSEND_TERMINAL_ID = "17";
const PACIFIC_ZONE = "America/Los_Angeles";
const CACHE_TTL_MS = 60 * 60 * 1000;
const TIDAL_ROUTE_KEYS = new Set([
  `${COUPEVILLE_TERMINAL_ID}:${PORT_TOWNSEND_TERMINAL_ID}`,
  `${PORT_TOWNSEND_TERMINAL_ID}:${COUPEVILLE_TERMINAL_ID}`,
]);

interface VesselLegendEntry {
  id?: string;
  name: string;
}

export interface TidalCancellation {
  arrivalId: string;
  departureId: string;
  departureTime: number;
  vesselId?: string;
  vesselName?: string;
  vesselPosition?: number;
}

let cachedCancellations: TidalCancellation[] | null = null;
let cachedAtMs = 0;
let inFlightFetch: Promise<TidalCancellation[]> | null = null;

// reset cancellation cache
export const resetTidalCancellationCache = (): void => {
  cachedCancellations = null;
  cachedAtMs = 0;
  inFlightFetch = null;
};

// normalize spaces
const normalizeText = (input: string | null | undefined): string =>
  (input ?? "").replace(/\s+/g, " ").trim();

// parse vessel legend
const parseVesselLegend = (
  document: Document
): Record<string, VesselLegendEntry> => {
  const legend: Record<string, VesselLegendEntry> = {};
  const vesselLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="vessel_id="][id*="hylVessel"]'
    )
  );
  vesselLinks.forEach((link) => {
    const row = link.closest("tr");
    // missing row guard
    if (!row) {
      return;
    }
    const position = normalizeText(row.querySelector("td")?.textContent);
    const vesselId = link.href.match(/[?&]vessel_id=(\d+)/i)?.[1];
    // missing position guard
    if (!position) {
      return;
    }
    legend[position] = {
      ...(vesselId ? { id: vesselId } : {}),
      name: normalizeText(link.textContent),
    };
  });
  return legend;
};

// parse sailing date
const parseCancellationDate = (
  dateText: string,
  year: number
): DateTime | null => {
  const match = dateText.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  // date text guard
  if (!match) {
    return null;
  }
  const [, month, day] = match;
  const date = DateTime.fromObject(
    { day: Number(day), month: Number(month), year },
    { zone: PACIFIC_ZONE }
  );
  // valid date guard
  if (!date.isValid) {
    return null;
  }
  return date;
};

// parse sailing time
const parseCancellationTime = (
  timeText: string,
  period: string
): {
  hour: number;
  minute: number;
} | null => {
  const match = normalizeText(timeText).match(/^(\d{1,2}):(\d{2})$/);
  // time text guard
  if (!match) {
    return null;
  }
  const [, hourText, minuteText] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  // pm conversion
  if (period === "pm" && hour < 12) {
    hour += 12;
  }
  // midnight conversion
  if (period === "am" && hour === 12) {
    hour = 0;
  }
  return { hour, minute };
};

// parse cancellation cell
const parseCancellationCell = (
  cell: Element | undefined,
  date: DateTime,
  departureId: string,
  arrivalId: string,
  vesselLegend: Record<string, VesselLegendEntry>
): TidalCancellation[] => {
  // missing cell guard
  if (!cell) {
    return [];
  }
  return Array.from(cell.querySelectorAll(":scope > span > div"))
    .map((entry): TidalCancellation | null => {
      const timeElement = entry.querySelector<HTMLElement>(".am, .pm");
      const vesselPositionText = normalizeText(
        entry.querySelector("span")?.textContent
      );
      const period = timeElement?.classList.contains("pm") ? "pm" : "am";
      const parsedTime = parseCancellationTime(
        timeElement?.textContent ?? "",
        period
      );
      // time guard
      if (!parsedTime) {
        return null;
      }
      const departureTime = date
        .set({
          hour: parsedTime.hour,
          minute: parsedTime.minute,
          second: 0,
          millisecond: 0,
        })
        .toSeconds();
      const vessel = vesselLegend[vesselPositionText];
      return {
        arrivalId,
        departureId,
        departureTime,
        ...(vessel?.id ? { vesselId: vessel.id } : {}),
        ...(vessel?.name ? { vesselName: vessel.name } : {}),
        ...(vesselPositionText
          ? { vesselPosition: Number(vesselPositionText) }
          : {}),
      };
    })
    .filter((entry): entry is TidalCancellation => Boolean(entry));
};

export const parseTidalCancellations = (html: string): TidalCancellation[] => {
  const { document } = new JSDOM(html).window;
  const vesselLegend = parseVesselLegend(document);
  return Array.from(document.querySelectorAll(".leftnavbox"))
    .flatMap((monthBox) => {
      const year = Number(
        normalizeText(monthBox.querySelector("h4")?.textContent).match(
          /\b(\d{4})\b/
        )?.[1]
      );
      // month header guard
      if (!year) {
        return [];
      }
      return Array.from(
        monthBox.querySelectorAll<HTMLTableRowElement>(
          "tr.addcancelcontent, tr.addcancelcontentseparator"
        )
      ).flatMap((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const date = parseCancellationDate(
          normalizeText(cells[0]?.textContent),
          year
        );
        // row date guard
        if (!date) {
          return [];
        }
        return [
          ...parseCancellationCell(
            cells[1],
            date,
            PORT_TOWNSEND_TERMINAL_ID,
            COUPEVILLE_TERMINAL_ID,
            vesselLegend
          ),
          ...parseCancellationCell(
            cells[2],
            date,
            COUPEVILLE_TERMINAL_ID,
            PORT_TOWNSEND_TERMINAL_ID,
            vesselLegend
          ),
        ];
      });
    })
    .sort((left, right) => left.departureTime - right.departureTime);
};

// fetch tidal cancellations
export const fetchTidalCancellations = async (): Promise<
  TidalCancellation[]
> => {
  const nowMs = Date.now();
  // cache guard
  if (cachedCancellations && nowMs - cachedAtMs < CACHE_TTL_MS) {
    return cachedCancellations;
  }
  // in-flight guard
  if (inFlightFetch) {
    return inFlightFetch;
  }
  const fetchPromise = (async () => {
    const response = await fetch(API_TIDAL_CANCELLATIONS, {
      headers: { Accept: "text/html" },
    });
    // response guard
    if (!response.ok) {
      throw new Error(`Tidal cancellation request failed: ${response.status}`);
    }
    cachedCancellations = parseTidalCancellations(await response.text());
    cachedAtMs = nowMs;
    return cachedCancellations;
  })();
  inFlightFetch = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    // active fetch guard
    if (inFlightFetch === fetchPromise) {
      inFlightFetch = null;
    }
  }
};

// get cancellations by schedule pair/date
export const getTidalCancellationsForDate = async (
  date: string,
  departureId: string,
  arrivalId: string
): Promise<TidalCancellation[]> => {
  // route guard
  if (!TIDAL_ROUTE_KEYS.has(`${departureId}:${arrivalId}`)) {
    return [];
  }
  const cancellations = await fetchTidalCancellations();
  return cancellations.filter((cancellation) => {
    // route guard
    if (
      cancellation.departureId !== departureId ||
      cancellation.arrivalId !== arrivalId
    ) {
      return false;
    }
    return (
      DateTime.fromSeconds(cancellation.departureTime, {
        zone: PACIFIC_ZONE,
      }).toFormat("yyyy-MM-dd") === date
    );
  });
};
