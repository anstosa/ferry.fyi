import { DateTime } from "luxon";

import logger from "~/lib/logger";

import { getErrorMessage } from "./errors";

const HOLIDAY_API_BASE = "https://date.nager.at/api/v3/PublicHolidays";
const HOLIDAY_COUNTRY = "US";
const WASHINGTON_SUBDIVISION = "US-WA";

const FIXED_HOLIDAY_DATES: Record<string, { day: number; month: number }> = {
  Christmas: { day: 25, month: 12 },
  "Independence Day": { day: 4, month: 7 },
  Juneteenth: { day: 19, month: 6 },
  "New Year's Day": { day: 1, month: 1 },
  "Veterans Day": { day: 11, month: 11 },
};

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

// fixed holiday aliases
const getFixedHolidayDate = (
  holiday: NagerHoliday,
  year: number
): string | null => {
  const holidayName = holiday.name || "";
  // fixed holiday search
  for (const [name, date] of Object.entries(FIXED_HOLIDAY_DATES)) {
    // name match guard
    if (!holidayName.includes(name)) {
      continue;
    }
    return DateTime.fromObject({ year, ...date }).toISODate();
  }
  return null;
};

// observed date expansion
const getHolidayDates = (holiday: NagerHoliday, year: number): string[] => {
  const dates = new Set([holiday.date]);
  const fixedDate = getFixedHolidayDate(holiday, year);
  // fixed date guard
  if (fixedDate) {
    dates.add(fixedDate);
  }
  return [...dates];
};

// test cache reset
export const clearWashingtonHolidayCache = (): void => {
  holidayCache.clear();
  holidayRequests.clear();
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
      holidays.filter(isWashingtonHoliday).flatMap((holiday) => {
        // observed holiday expansion
        return getHolidayDates(holiday, year);
      })
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
