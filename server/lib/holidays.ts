import logger from "heroku-logger";

const HOLIDAY_API_BASE = "https://date.nager.at/api/v3/PublicHolidays";
const HOLIDAY_COUNTRY = "US";
const WASHINGTON_SUBDIVISION = "US-WA";

interface NagerHoliday {
  counties: string[] | null;
  date: string;
  global: boolean;
  name: string;
  types: string[];
}

const holidayCache = new Map<number, Set<string>>();
const holidayRequests = new Map<number, Promise<Set<string>>>();

// public holiday check
const isPublicHoliday = (holiday: NagerHoliday): boolean =>
  holiday.types.includes("Public");

// washington holiday check
const isWashingtonHoliday = (holiday: NagerHoliday): boolean => {
  // public holiday guard
  if (!isPublicHoliday(holiday)) {
    return false;
  }
  // federal holiday guard
  if (holiday.global) {
    return true;
  }
  return Boolean(holiday.counties?.includes(WASHINGTON_SUBDIVISION));
};

// test cache reset
export const clearWashingtonHolidayCache = (): void => {
  holidayCache.clear();
  holidayRequests.clear();
};

// error message extraction
const getErrorMessage = (error: unknown): string => {
  // error object guard
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// washington holiday request
const fetchWashingtonHolidayDates = async (
  year: number
): Promise<Set<string>> => {
  try {
    const response = await fetch(
      `${HOLIDAY_API_BASE}/${year}/${HOLIDAY_COUNTRY}`
    );
    // api failure guard
    if (!response.ok) {
      throw new Error(`Holiday API returned ${response.status}`);
    }

    const holidays = (await response.json()) as NagerHoliday[];
    // response shape guard
    if (!Array.isArray(holidays)) {
      throw new Error("Holiday API returned invalid holiday list");
    }

    const holidayDates = new Set(
      holidays.filter(isWashingtonHoliday).map(({ date }) => date)
    );
    holidayCache.set(year, holidayDates);
    return holidayDates;
  } catch (error) {
    logger.warn("Unable to fetch Washington holidays", {
      error: getErrorMessage(error),
      year,
    });
    return new Set();
  }
};

// washington holiday fetch
export const getWashingtonHolidayDates = async (
  year: number
): Promise<Set<string>> => {
  const cachedHolidays = holidayCache.get(year);
  // cache hit guard
  if (cachedHolidays) {
    return new Set(cachedHolidays);
  }

  const pendingRequest = holidayRequests.get(year);
  // in-flight request guard
  if (pendingRequest) {
    return new Set(await pendingRequest);
  }

  const request = fetchWashingtonHolidayDates(year);
  holidayRequests.set(year, request);
  try {
    return new Set(await request);
  } finally {
    holidayRequests.delete(year);
  }
};
