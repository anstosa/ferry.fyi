import { DateTime } from "luxon";

const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_PROVIDER = "open-meteo";

export const OPEN_METEO_FREE_LIMITS = {
  daily: 10_000,
  hourly: 5_000,
  minutely: 600,
};

export interface OpenMeteoWeatherRecord {
  cloudCoverPercent: number | null;
  latitude: number;
  longitude: number;
  precipitationMm: number | null;
  provider: string;
  temperatureC: number | null;
  timezone: string | null;
  time: number;
  windSpeedKmh: number | null;
}

interface OpenMeteoHourlyResponse {
  elevation?: number;
  generationtime_ms?: number;
  hourly?: {
    cloud_cover?: Array<number | null>;
    precipitation?: Array<number | null>;
    temperature_2m?: Array<number | null>;
    time?: string[];
    wind_speed_10m?: Array<number | null>;
  };
  latitude: number;
  longitude: number;
  timezone?: string;
}

interface ValidOpenMeteoHourly {
  cloud_cover: Array<number | null>;
  precipitation: Array<number | null>;
  temperature_2m: Array<number | null>;
  time: string[];
  wind_speed_10m: Array<number | null>;
}

interface FetchWeatherInput {
  endDate: string;
  fetchImpl?: typeof fetch;
  latitude: number;
  longitude: number;
  startDate: string;
  timeoutMs?: number;
}

const OPEN_METEO_TIMEOUT_MS = 10_000;
const HOURLY_VARIABLES = [
  "temperature_2m",
  "cloud_cover",
  "wind_speed_10m",
  "precipitation",
] as const;

// read nullable number
const readNullableNumber = (
  values: Array<number | null> | undefined,
  index: number
): number | null => values?.[index] ?? null;

// validate hourly payload
const readHourlyPayload = (
  hourly: OpenMeteoHourlyResponse["hourly"]
): ValidOpenMeteoHourly => {
  // missing hourly guard
  if (!hourly?.time) {
    throw new Error("Open-Meteo response missing hourly time");
  }
  // required value arrays
  for (const key of HOURLY_VARIABLES) {
    // missing value guard
    if (!Array.isArray(hourly[key])) {
      throw new Error(`Open-Meteo response missing hourly ${key}`);
    }
  }
  return hourly as ValidOpenMeteoHourly;
};

// build api url
const buildWeatherUrl = (
  baseUrl: string,
  { endDate, latitude, longitude, startDate }: FetchWeatherInput
): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("hourly", HOURLY_VARIABLES.join(","));
  url.searchParams.set("timezone", "America/Los_Angeles");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  return url.toString();
};

// normalize response
export const normalizeOpenMeteoResponse = (
  response: OpenMeteoHourlyResponse
): OpenMeteoWeatherRecord[] => {
  const hourly = readHourlyPayload(response.hourly);
  return hourly.time.map((time, index) => ({
    cloudCoverPercent: readNullableNumber(hourly.cloud_cover, index),
    latitude: response.latitude,
    longitude: response.longitude,
    precipitationMm: readNullableNumber(hourly.precipitation, index),
    provider: OPEN_METEO_PROVIDER,
    temperatureC: readNullableNumber(hourly.temperature_2m, index),
    timezone: response.timezone ?? null,
    time: DateTime.fromISO(time, { zone: "America/Los_Angeles" }).toSeconds(),
    windSpeedKmh: readNullableNumber(hourly.wind_speed_10m, index),
  }));
};

// fetch weather records
const fetchWeather = async (
  baseUrl: string,
  input: FetchWeatherInput
): Promise<OpenMeteoWeatherRecord[]> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? OPEN_METEO_TIMEOUT_MS;
  // request timeout
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // provider request
  try {
    const response = await fetchImpl(buildWeatherUrl(baseUrl, input), {
      signal: controller.signal,
    });
    // response guard
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed: ${response.status}`);
    }
    return normalizeOpenMeteoResponse(
      (await response.json()) as OpenMeteoHourlyResponse
    );
  } finally {
    clearTimeout(timeout);
  }
};

// fetch historical records
export const fetchHistoricalWeather = (
  input: FetchWeatherInput
): Promise<OpenMeteoWeatherRecord[]> =>
  fetchWeather(OPEN_METEO_ARCHIVE_URL, input);

// fetch forecast records
export const fetchForecastWeather = (
  input: FetchWeatherInput
): Promise<OpenMeteoWeatherRecord[]> =>
  fetchWeather(OPEN_METEO_FORECAST_URL, input);

// estimate request cost
export const estimateOpenMeteoCallCost = (days: number): number =>
  Math.max(1, Math.ceil(days / 14));

// expose archive url
export const getOpenMeteoArchiveUrl = (input: FetchWeatherInput): string =>
  buildWeatherUrl(OPEN_METEO_ARCHIVE_URL, input);

// expose forecast url
export const getOpenMeteoForecastUrl = (input: FetchWeatherInput): string =>
  buildWeatherUrl(OPEN_METEO_FORECAST_URL, input);
