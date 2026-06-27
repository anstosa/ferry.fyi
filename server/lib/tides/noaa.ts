import { DateTime } from "luxon";

const NOAA_TIDE_URL =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_TIDE_PROVIDER = "noaa-coops";
const NOAA_TIDE_DATUM = "MLLW";
const NOAA_TIDE_TIMEZONE = "America/Los_Angeles";
const NOAA_TIDE_TIMEOUT_MS = 10_000;
const NOAA_TIDE_APPLICATION = process.env.NOAA_TIDE_APPLICATION ?? "ferry_fyi";

export interface NoaaTideRecord {
  datum: string;
  provider: string;
  stationId: string;
  time: number;
  timezone: string;
  waterLevelM: number | null;
}

interface FetchTideInput {
  endDate: string;
  fetchImpl?: typeof fetch;
  stationId: string;
  startDate: string;
  timeoutMs?: number;
}

interface NoaaTidePrediction {
  t: string;
  v: string;
}

interface NoaaTideResponse {
  error?: { message?: string };
  predictions?: NoaaTidePrediction[];
}

// format noaa date
const toNoaaDate = (date: string): string =>
  DateTime.fromISO(date, { zone: NOAA_TIDE_TIMEZONE }).toFormat("yyyyLLdd");

// parse noaa hour
const parseNoaaTime = (time: string): number =>
  DateTime.fromFormat(time, "yyyy-MM-dd HH:mm", {
    zone: NOAA_TIDE_TIMEZONE,
  }).toSeconds();

// parse nullable level
const parseWaterLevel = (value: string): number | null => {
  const parsed = Number(value);
  // numeric guard
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

// build api url
const buildNoaaTideUrl = ({
  endDate,
  stationId,
  startDate,
}: FetchTideInput): string => {
  const url = new URL(NOAA_TIDE_URL);
  url.searchParams.set("begin_date", toNoaaDate(startDate));
  url.searchParams.set("end_date", toNoaaDate(endDate));
  url.searchParams.set("station", stationId);
  url.searchParams.set("product", "predictions");
  url.searchParams.set("datum", NOAA_TIDE_DATUM);
  url.searchParams.set("time_zone", "lst_ldt");
  url.searchParams.set("interval", "h");
  url.searchParams.set("units", "metric");
  url.searchParams.set("format", "json");
  url.searchParams.set("application", NOAA_TIDE_APPLICATION);
  return url.toString();
};

// normalize response
export const normalizeNoaaTideResponse = (
  stationId: string,
  response: NoaaTideResponse
): NoaaTideRecord[] => {
  // provider error guard
  if (response.error?.message) {
    throw new Error(`NOAA tide request failed: ${response.error.message}`);
  }
  // missing predictions guard
  if (!Array.isArray(response.predictions)) {
    throw new Error("NOAA tide response missing predictions");
  }
  return response.predictions.map((prediction) => ({
    datum: NOAA_TIDE_DATUM,
    provider: NOAA_TIDE_PROVIDER,
    stationId,
    time: parseNoaaTime(prediction.t),
    timezone: NOAA_TIDE_TIMEZONE,
    waterLevelM: parseWaterLevel(prediction.v),
  }));
};

// fetch tide records
export const fetchTidePredictions = async (
  input: FetchTideInput
): Promise<NoaaTideRecord[]> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? NOAA_TIDE_TIMEOUT_MS;
  // request timeout
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // provider request
  try {
    const response = await fetchImpl(buildNoaaTideUrl(input), {
      signal: controller.signal,
    });
    // response guard
    if (!response.ok) {
      throw new Error(`NOAA tide request failed: ${response.status}`);
    }
    return normalizeNoaaTideResponse(
      input.stationId,
      (await response.json()) as NoaaTideResponse
    );
  } finally {
    clearTimeout(timeout);
  }
};

// expose provider url
export const getNoaaTideUrl = (input: FetchTideInput): string =>
  buildNoaaTideUrl(input);
