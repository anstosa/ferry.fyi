import { setImmediate as waitForImmediate } from "node:timers/promises";

import { DateTime } from "luxon";
import { Op } from "sequelize";
import {
  CrossingEstimate,
  ForecastConfidence,
  type ForecastFactor,
  type ForecastFullRisk,
  type ForecastRouteClass,
  Slot,
  type SlotTide,
  type SlotWeather,
} from "shared/contracts/schedules";
import { isEmpty } from "shared/lib/arrays";
import { constrain, round } from "shared/lib/math";
import { values } from "shared/lib/objects";
import {
  formatFeetBelowAverageLowTide,
  getTidalCancellationRisk,
} from "shared/lib/tidalCancellationRisk";

import {
  type DemandCalendarProfile,
  getDemandCalendarProfile,
} from "~/lib/demandCalendar";
import { getForecastDaypart } from "~/lib/forecastDaypart";
import {
  alignDemandShockPointEstimate,
  createDemandShockHistoryIndex,
  type DemandShockAdjustment,
  type DemandShockHistorySource,
  getDemandShockAdjustment,
  regularizeDemandShockProbability,
  shiftCapacitySamplesForDemand,
} from "~/lib/forecastDemandShock";
import { getWashingtonHolidayDates } from "~/lib/holidays";
import logger from "~/lib/logger";
import { formatLogBlock } from "~/lib/logging";
import {
  createTideForecastContext,
  type TideConditions,
} from "~/lib/tides/context";
import {
  createWeatherAdjustmentContext,
  getWeatherAdjustedCapacity,
  type WeatherConditions,
} from "~/lib/weather/capacityAdjustment";
import Crossing from "~/models/Crossing";
import { DemandEvent } from "~/models/DemandEvent";
import { ForecastCalibration } from "~/models/ForecastCalibration";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const ESTIMATE_COMPOSITE_YEARS = 2;
const DELAY_DISRUPTION_SECONDS = 15 * 60;
const CANCELLED_CAPACITY_ROLLOVER_SHARE = 0.6;
const HOLIDAY_WINDOW_DAYS = 2;
const MIN_WEIGHT = 0.1;
const CAPACITY_REPORT_STALE_SECONDS = 30 * 60;
const LEGACY_EARLY_PLACEHOLDER_CAPACITY_HOURS = 4;
const MIN_TELEMETRY_COMPONENT_DELTA = 0.01;
const ZENITH = 90.833;
const HISTORY_YEAR_SECONDS = 365.25 * 24 * 60 * 60;

// count formatter
const FORECAST_COUNT_FORMATTER = new Intl.NumberFormat("en-US");
// holiday name cache
const knownHolidayDateCache = new Map<number, Map<string, string>>();

export type HolidayDateMap = Record<number, Set<string>>;

interface CapacityPair {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

export type CapacityReportingGate = "off" | "on";
export type DemandShockMode = "off" | "on" | "shadow";

export interface DemandShockModeResult<T> {
  candidate: T | null;
  selected: T;
}

interface HistoricalSample extends CapacityPair {
  crossing: Crossing;
  weight: number;
}

export interface HistoricalEstimate extends CapacityPair {
  demandShockAdjustment?: DemandShockAdjustment;
  factors: ForecastFactor[];
  fullProbability: number;
  fullRisk: ForecastFullRisk;
  routeClass: ForecastRouteClass;
  sampleSize: number;
  weight: number;
}

interface PeakCalibration {
  demandPressure: number;
  fullProbability: number;
  fullRisk: ForecastFullRisk;
  routeClass: ForecastRouteClass;
  shouldUsePeakCapacity: boolean;
  weightedFullShare: number;
  weightedFullishShare: number;
  weightedQuantile: number;
}

interface NormalizedCapacitySample extends CapacityPair {
  hasReservations: boolean;
  weight: number;
}

export interface HistoricalEstimateInputAudit {
  arrivalId: string;
  asOf: number;
  departureId: string;
  samples: Array<{
    arrivalId: string;
    departureId: string;
    departureTime: number;
    driveUpCapacity: number;
    id: number | string | null;
    normalizedDriveUpCapacity: number;
    normalizedReservableCapacity: number | null;
    reservableCapacity: number | null;
    totalCapacity: number;
    weight: number;
  }>;
  targetCapacity: number;
  targetDepartureTime: number;
}

interface HistoricalRecordSummary {
  historyYears: number;
  totalSailings: number;
}

interface DemandProfile {
  calendar: DemandCalendarProfile;
  daysUntilHoliday: number | null;
  holidayName: string | null;
  isHolidayDate: boolean;
  isHolidayWindow: boolean;
  schoolBreakName: string | null;
  sportsTeamName: string | null;
}

interface HistoricalRouteContext {
  arrivalId: string;
  calibration?: ForecastCalibration | null;
  demandProfileCache?: Map<number, DemandProfile>;
  demandShock?: {
    asOf: number;
    baselineFullProbability: number;
    history: DemandShockHistorySource;
  };
  departureId: string;
  events?: DemandEvent[];
  onInputAudit?: (audit: HistoricalEstimateInputAudit) => void;
  recordSummary?: HistoricalRecordSummary;
  sampleWeightCache?: Map<string, number>;
}

interface HistoricalCrossingCandidate {
  crossing: Crossing;
  isHoliday: boolean;
  isHolidayWindow: boolean;
  time: DateTime;
}

const warnedForecastSettings = new Set<string>();

// parse one rollout setting
const getForecastSetting = <T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T
): T => {
  const value = process.env[name];
  // use the documented default
  if (!value) {
    return fallback;
  }
  // accept a supported value
  if (allowed.includes(value as T)) {
    return value as T;
  }
  // warn once per invalid setting
  if (!warnedForecastSettings.has(`${name}:${value}`)) {
    warnedForecastSettings.add(`${name}:${value}`);
    logger.warn(`${name}=${value} is invalid; using ${fallback}`);
  }
  return fallback;
};

// read the reporting-state gate
export const getCapacityReportingGate = (): CapacityReportingGate =>
  getForecastSetting(
    "FORECAST_CAPACITY_REPORTING_GATE",
    ["off", "on"] as const,
    "on"
  );

// read the demand-shock mode
export const getDemandShockMode = (): DemandShockMode => {
  const fallback = process.env.NODE_ENV === "production" ? "shadow" : "on";
  return getForecastSetting(
    "FORECAST_DEMAND_SHOCK_MODE",
    ["off", "shadow", "on"] as const,
    fallback
  );
};

// execute one lazy demand candidate
export const runDemandShockMode = async <T>(
  mode: DemandShockMode,
  baseline: T,
  buildCandidate: () => Promise<T>
): Promise<DemandShockModeResult<T>> => {
  // skip candidate work when disabled
  if (mode === "off") {
    return { candidate: null, selected: baseline };
  }
  const candidate = await buildCandidate();
  return {
    candidate,
    selected: mode === "on" ? candidate : baseline,
  };
};

// normalize degrees
const normalizeDegrees = (degrees: number): number =>
  ((degrees % 360) + 360) % 360;

// convert degrees
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

// convert radians
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

// daylight approximation
const isDaylight = (time: DateTime, terminal: Terminal | null): boolean => {
  // missing terminal guard
  if (!terminal) {
    return time.hour >= 7 && time.hour < 19;
  }
  const { latitude, longitude } = terminal.location;
  const dayOfYear = time.ordinal;
  const longitudeHour = longitude / 15;
  const approximateTime = dayOfYear + (12 - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(toRadians(meanAnomaly)) +
      0.02 * Math.sin(toRadians(2 * meanAnomaly)) +
      282.634
  );
  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosLocalHour =
    (Math.cos(toRadians(ZENITH)) -
      sinDeclination * Math.sin(toRadians(latitude))) /
    (cosDeclination * Math.cos(toRadians(latitude)));

  // all-day guard
  if (cosLocalHour < -1) {
    return true;
  }

  // no-daylight guard
  if (cosLocalHour > 1) {
    return false;
  }

  const hourAngle = toDegrees(Math.acos(cosLocalHour)) / 15;
  const solarNoon = 12 - longitudeHour + time.offset / 60;
  const sunrise = solarNoon - hourAngle;
  const sunset = solarNoon + hourAngle;
  const localHour = time.hour + time.minute / 60;
  return localHour >= sunrise && localHour <= sunset;
};

// month distance
const getMonthDistance = (left: DateTime, right: DateTime): number => {
  const raw = Math.abs(left.month - right.month);
  return Math.min(raw, 12 - raw);
};

// recency weight
const getRecencyWeight = (target: DateTime, crossing: Crossing): number => {
  const weeksAgo = Math.max(
    1,
    target.diff(DateTime.fromSeconds(crossing.departureTime), "weeks").weeks
  );
  return 1 / weeksAgo;
};

// holiday date check
const isHolidayDate = (time: DateTime, holidays: HolidayDateMap): boolean => {
  const date = time.toISODate();
  // date format guard
  if (!date) {
    return false;
  }
  return holidays[time.year]?.has(date) ?? false;
};

// holiday travel window check
const isHolidayWindowDate = (
  time: DateTime,
  holidays: HolidayDateMap
): boolean => {
  // nearby holiday scan
  for (
    let offset = -HOLIDAY_WINDOW_DAYS;
    offset <= HOLIDAY_WINDOW_DAYS;
    offset++
  ) {
    const windowTime = time.plus({ days: offset });
    const windowDate = windowTime.toISODate();
    // date format guard
    if (!windowDate) {
      continue;
    }
    // window match guard
    if (holidays[windowTime.year]?.has(windowDate)) {
      return true;
    }
  }
  return false;
};

// nearest holiday offset
const getDaysUntilHoliday = (
  time: DateTime,
  holidays: HolidayDateMap
): number | null => {
  // nearby holiday scan
  for (let offset = 0; offset <= HOLIDAY_WINDOW_DAYS; offset++) {
    const futureTime = time.plus({ days: offset });
    const futureDate = futureTime.toISODate();
    // future date guard
    if (futureDate && holidays[futureTime.year]?.has(futureDate)) {
      return offset;
    }
    const pastTime = time.minus({ days: offset });
    const pastDate = pastTime.toISODate();
    // past date guard
    if (pastDate && holidays[pastTime.year]?.has(pastDate)) {
      return -offset;
    }
  }
  return null;
};

// ordinal weekday
const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  occurrence: number
): string | null => {
  const firstDay = DateTime.fromObject({ day: 1, month, year });
  const daysUntilWeekday = (weekday - firstDay.weekday + 7) % 7;
  return firstDay
    .plus({ days: daysUntilWeekday + (occurrence - 1) * 7 })
    .toISODate();
};

// last weekday
const getLastWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number
): string | null => {
  const lastDay = DateTime.fromObject({ day: 1, month, year })
    .endOf("month")
    .startOf("day");
  const daysSinceWeekday = (lastDay.weekday - weekday + 7) % 7;
  return lastDay.minus({ days: daysSinceWeekday }).toISODate();
};

// fixed holiday observed dates
const getFixedHolidayDates = (
  year: number,
  month: number,
  day: number
): string[] => {
  const date = DateTime.fromObject({ day, month, year });
  const dates = new Set<string>();
  const calendarDate = date.toISODate();
  // calendar date guard
  if (calendarDate) {
    dates.add(calendarDate);
  }
  // saturday observed guard
  if (date.weekday === 6) {
    const observedDate = date.minus({ days: 1 }).toISODate();
    // observed date guard
    if (observedDate) {
      dates.add(observedDate);
    }
  }
  // sunday observed guard
  if (date.weekday === 7) {
    const observedDate = date.plus({ days: 1 }).toISODate();
    // observed date guard
    if (observedDate) {
      dates.add(observedDate);
    }
  }
  return [...dates];
};

// known holiday names
const getKnownHolidayDates = (year: number): Map<string, string> => {
  const cachedHolidays = knownHolidayDateCache.get(year);
  // cache hit guard
  if (cachedHolidays) {
    return cachedHolidays;
  }
  const holidays = new Map<string, string>();
  const addHoliday = (date: string | null, name: string): void => {
    // date guard
    if (!date) {
      return;
    }
    holidays.set(date, name);
  };
  const addFixedHoliday = (name: string, month: number, day: number): void => {
    // fixed holiday dates
    getFixedHolidayDates(year, month, day).forEach((date) => {
      holidays.set(date, name);
    });
  };
  addFixedHoliday("New Year's Day", 1, 1);
  addHoliday(getNthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day");
  addHoliday(getNthWeekdayOfMonth(year, 2, 1, 3), "Presidents' Day");
  addHoliday(getLastWeekdayOfMonth(year, 5, 1), "Memorial Day");
  addFixedHoliday("Juneteenth", 6, 19);
  addFixedHoliday("Independence Day", 7, 4);
  addHoliday(getNthWeekdayOfMonth(year, 9, 1, 1), "Labor Day");
  addHoliday(getNthWeekdayOfMonth(year, 10, 1, 2), "Indigenous Peoples' Day");
  addFixedHoliday("Veterans Day", 11, 11);
  const thanksgiving = getNthWeekdayOfMonth(year, 11, 4, 4);
  addHoliday(thanksgiving, "Thanksgiving");
  // native heritage day guard
  if (thanksgiving) {
    addHoliday(
      DateTime.fromISO(thanksgiving).plus({ days: 1 }).toISODate(),
      "Native American Heritage Day"
    );
  }
  addFixedHoliday("Christmas", 12, 25);
  knownHolidayDateCache.set(year, holidays);
  return holidays;
};

// holiday name lookup
const getHolidayName = (
  time: DateTime,
  holidays: HolidayDateMap
): string | null => {
  const offset = getDaysUntilHoliday(time, holidays);
  // holiday offset guard
  if (offset === null) {
    return null;
  }
  const holidayTime = time.plus({ days: offset });
  const holidayDate = holidayTime.toISODate();
  // holiday date guard
  if (!holidayDate) {
    return "holiday";
  }
  return getKnownHolidayDates(holidayTime.year).get(holidayDate) ?? "holiday";
};

// active event title
const getActiveEventTitle = (
  time: DateTime,
  route: HistoricalRouteContext,
  eventType: DemandEvent["eventType"]
): string | null => {
  const timestamp = time.toSeconds();
  // event scan
  for (const event of route.events ?? []) {
    // event type guard
    if (event.eventType !== eventType) {
      continue;
    }
    // active event guard
    if (timestamp >= event.startsAt && timestamp <= event.endsAt) {
      return event.title;
    }
  }
  return null;
};

// school break name
const getSchoolBreakName = (
  time: DateTime,
  route: HistoricalRouteContext
): string | null => {
  const eventTitle = getActiveEventTitle(time, route, "school-break");
  // event title guard
  if (eventTitle) {
    return eventTitle
      .replace(/^Washington\\s+/i, "")
      .replace(/\\s+school break$/i, "");
  }
  const monthDay = time.toFormat("MM-dd");
  // winter fallback
  if (monthDay >= "12-20" || monthDay <= "01-03") {
    return "winter break";
  }
  // spring fallback
  if (time.month === 4 && time.day >= 5 && time.day <= 18) {
    return "spring break";
  }
  return "mid-winter break";
};

// recreation direction
const isSportsTravelWindow = (
  time: DateTime,
  route: HistoricalRouteContext,
  event: DemandEvent
): boolean => {
  const hoursFromStart = (time.toSeconds() - event.startsAt) / (60 * 60);
  const gatewayTerminalIds = new Set(["1", "7", "8", "9", "14", "16", "17"]);
  const recreationTerminalIds = new Set([
    "3",
    "4",
    "5",
    "10",
    "11",
    "12",
    "13",
    "15",
    "18",
    "20",
    "21",
    "22",
  ]);
  const inbound =
    recreationTerminalIds.has(route.departureId) &&
    gatewayTerminalIds.has(route.arrivalId);
  const outbound =
    gatewayTerminalIds.has(route.departureId) &&
    recreationTerminalIds.has(route.arrivalId);
  return (
    (inbound && hoursFromStart >= -4 && hoursFromStart <= 1) ||
    (outbound && hoursFromStart >= 2 && hoursFromStart <= 7)
  );
};

// Seattle team name
const getSeattleTeamName = (title: string): string => {
  const teams = [
    "Seattle Mariners",
    "Seattle Seahawks",
    "Seattle Kraken",
    "Seattle Sounders",
    "Seattle Storm",
  ];
  const matchedTeam = teams.find((team) => {
    // title match
    return title.includes(team);
  });
  return matchedTeam ?? title;
};

// active sports team
const getSportsTeamName = (
  time: DateTime,
  route: HistoricalRouteContext
): string | null => {
  const event = (route.events ?? []).find((candidate) => {
    // sports event guard
    if (candidate.eventType !== "sports") {
      return false;
    }
    return isSportsTravelWindow(time, route, candidate);
  });
  return event ? getSeattleTeamName(event.title) : null;
};

// demand profile
const getDemandProfile = (
  slotTime: DateTime,
  holidays: HolidayDateMap,
  route: HistoricalRouteContext
): DemandProfile => {
  const calendar = getDemandCalendarProfile({
    arrivalId: route.arrivalId,
    departureId: route.departureId,
    events: route.events,
    time: slotTime,
  });
  return {
    calendar,
    daysUntilHoliday: getDaysUntilHoliday(slotTime, holidays),
    holidayName: getHolidayName(slotTime, holidays),
    isHolidayDate: isHolidayDate(slotTime, holidays),
    isHolidayWindow: isHolidayWindowDate(slotTime, holidays),
    schoolBreakName: getSchoolBreakName(slotTime, route),
    sportsTeamName: getSportsTeamName(slotTime, route),
  };
};

// reuse one route profile per departure time
const getCachedDemandProfile = (
  slotTime: DateTime,
  holidays: HolidayDateMap,
  route: HistoricalRouteContext
): DemandProfile => {
  const cacheKey = slotTime.toSeconds();
  const cachedProfile = route.demandProfileCache?.get(cacheKey);
  // cached profile guard
  if (cachedProfile) {
    return cachedProfile;
  }
  const profile = getDemandProfile(slotTime, holidays, route);
  route.demandProfileCache?.set(cacheKey, profile);
  return profile;
};

// holiday match multiplier
const getHolidayWeight = (
  target: DateTime,
  crossingTime: DateTime,
  holidays: HolidayDateMap
): number => {
  const targetIsHoliday = isHolidayDate(target, holidays);
  const crossingIsHoliday = isHolidayDate(crossingTime, holidays);
  // holiday target match
  if (targetIsHoliday && crossingIsHoliday) {
    return 8;
  }
  const targetIsHolidayWindow = isHolidayWindowDate(target, holidays);
  const crossingIsHolidayWindow = isHolidayWindowDate(crossingTime, holidays);
  // holiday window match
  if (targetIsHolidayWindow && crossingIsHolidayWindow) {
    return 4;
  }
  // holiday target mismatch
  if (targetIsHoliday || targetIsHolidayWindow) {
    return 0.25;
  }
  // historical holiday mismatch
  if (crossingIsHoliday || crossingIsHolidayWindow) {
    return 0.5;
  }
  return 1.1;
};

// comparable crossing check
const isComparableCrossing = (
  target: DateTime,
  crossing: Crossing,
  now: DateTime,
  holidays: HolidayDateMap
): boolean => {
  const crossingTime = DateTime.fromSeconds(crossing.departureTime);
  // future outcome guard
  if (crossingTime >= now) {
    return false;
  }
  // cancellation guard
  if (crossing.isCancelled) {
    return false;
  }
  const hourDistance = Math.abs(crossingTime.hour - target.hour);
  // hour distance guard
  if (hourDistance > 2) {
    return false;
  }
  const targetIsHoliday = isHolidayDate(target, holidays);
  const crossingIsHoliday = isHolidayDate(crossingTime, holidays);
  // annual holiday match
  if (targetIsHoliday && crossingIsHoliday) {
    return true;
  }
  const targetIsHolidayWindow = isHolidayWindowDate(target, holidays);
  const crossingIsHolidayWindow = isHolidayWindowDate(crossingTime, holidays);
  // holiday window match
  if (targetIsHolidayWindow && crossingIsHolidayWindow) {
    return true;
  }
  return crossingTime.weekday === target.weekday;
};

// historical candidate cache
const getHistoricalCrossingCandidates = (
  crossings: Crossing[],
  now: DateTime,
  holidays: HolidayDateMap
): HistoricalCrossingCandidate[] =>
  crossings
    .map((crossing) => {
      const time = DateTime.fromSeconds(crossing.departureTime);
      return {
        crossing,
        isHoliday: isHolidayDate(time, holidays),
        isHolidayWindow: isHolidayWindowDate(time, holidays),
        time,
      };
    })
    .filter(({ crossing, time }) => {
      // future outcome guard
      if (time >= now) {
        return false;
      }
      return !crossing.isCancelled;
    });

// comparable candidate crossings
const getComparableCrossingsFromCandidates = (
  target: DateTime,
  candidates: HistoricalCrossingCandidate[],
  holidays: HolidayDateMap
): Crossing[] => {
  const targetIsHoliday = isHolidayDate(target, holidays);
  const targetIsHolidayWindow = isHolidayWindowDate(target, holidays);
  return candidates
    .filter(({ isHoliday, isHolidayWindow, time }) => {
      const hourDistance = Math.abs(time.hour - target.hour);
      // hour distance guard
      if (hourDistance > 2) {
        return false;
      }
      // holiday match guard
      if (targetIsHoliday && isHoliday) {
        return true;
      }
      // holiday window match guard
      if (targetIsHolidayWindow && isHolidayWindow) {
        return true;
      }
      return time.weekday === target.weekday;
    })
    .map(({ crossing }) => crossing);
};

// historical sample weight
const getSampleWeight = (
  target: DateTime,
  crossing: Crossing,
  terminal: Terminal | null,
  holidays: HolidayDateMap,
  targetProfile: DemandProfile,
  route: HistoricalRouteContext
): number => {
  const cacheKey = `${target.toSeconds()}:${crossing.departureTime}`;
  const cachedWeight = route.sampleWeightCache?.get(cacheKey);
  // cached weight guard
  if (cachedWeight !== undefined) {
    return cachedWeight;
  }
  const crossingTime = DateTime.fromSeconds(crossing.departureTime);
  let weight = getRecencyWeight(target, crossing);
  weight *= getHolidayWeight(target, crossingTime, holidays);
  const crossingProfile = getCachedDemandProfile(crossingTime, holidays, route);
  weight *= getDemandCalendarWeight(targetProfile, crossingProfile);
  // hour match boost
  if (crossingTime.hour === target.hour) {
    weight *= 1.5;
  }
  // season match boost
  if (getMonthDistance(target, crossingTime) <= 1) {
    weight *= 1.25;
  }
  // daylight match boost
  if (isDaylight(target, terminal) === isDaylight(crossingTime, terminal)) {
    weight *= 1.2;
  }
  const boundedWeight = Math.max(weight, MIN_WEIGHT);
  route.sampleWeightCache?.set(cacheKey, boundedWeight);
  return boundedWeight;
};

// calendar similarity weight
const getDemandCalendarWeight = (
  target: DemandProfile,
  sample: DemandProfile
): number => {
  let weight = 1;
  const pressureDifference = Math.abs(
    target.calendar.totalPressure - sample.calendar.totalPressure
  );
  // matching surge guard
  if (target.calendar.totalPressure > 0 && pressureDifference <= 0.05) {
    weight *= 1.35;
  }
  // mismatched surge guard
  if (pressureDifference > 0.12) {
    weight *= 0.75;
  }
  // sports match guard
  if (target.calendar.sportsEventPressure > 0) {
    weight *= sample.calendar.sportsEventPressure > 0 ? 1.4 : 0.8;
  }
  return weight;
};

// weighted average
const weightedMean = (
  values: Array<{ value: number; weight: number }>
): number => {
  let weightedTotal = 0;
  let totalWeight = 0;
  // accumulate weighted values
  values.forEach(({ value, weight }) => {
    weightedTotal += value * weight;
    totalWeight += weight;
  });
  return totalWeight ? weightedTotal / totalWeight : 0;
};

// weighted quantile
const weightedQuantile = (
  values: Array<{ value: number; weight: number }>,
  quantile: number
): number => {
  const sortedValues = [...values].sort((left, right) => {
    return left.value - right.value;
  });
  const totalWeight = sortedValues.reduce((total, { weight }) => {
    return total + weight;
  }, 0);
  const threshold = totalWeight * quantile;
  let accumulatedWeight = 0;
  // quantile accumulation
  for (const { value, weight } of sortedValues) {
    accumulatedWeight += weight;
    // threshold guard
    if (accumulatedWeight >= threshold) {
      return value;
    }
  }
  return sortedValues[sortedValues.length - 1]?.value ?? 0;
};

// total available capacity
const getAvailableCapacity = (capacity: CapacityPair): number =>
  capacity.driveUpCapacity + (capacity.reservableCapacity ?? 0);

// slot vehicle capacity
const getSlotVehicleCapacity = (slot: Slot): number => {
  const { tallVehicleCapacity, vehicleCapacity } = slot.vessel;
  return vehicleCapacity - tallVehicleCapacity;
};

// normalize historical sample
const normalizeHistoricalSample = (
  sample: HistoricalSample,
  targetTotalCapacity: number
): NormalizedCapacitySample => {
  const { crossing, driveUpCapacity, reservableCapacity, weight } = sample;
  const totalAvailable = driveUpCapacity + (reservableCapacity ?? 0);
  const occupiedSpaces = constrain(
    crossing.totalCapacity - totalAvailable,
    0,
    crossing.totalCapacity
  );
  const targetAvailable = constrain(
    targetTotalCapacity - occupiedSpaces,
    0,
    targetTotalCapacity
  );
  const reservableShare = totalAvailable
    ? (reservableCapacity ?? 0) / totalAvailable
    : 0;
  const normalizedReservableCapacity = round(targetAvailable * reservableShare);
  return {
    driveUpCapacity: targetAvailable - normalizedReservableCapacity,
    hasReservations: crossing.hasReservations,
    reservableCapacity: normalizedReservableCapacity,
    weight,
  };
};

// weighted share
const getWeightedShare = (
  samples: NormalizedCapacitySample[],
  predicate: (sample: NormalizedCapacitySample) => boolean
): number => {
  let matchingWeight = 0;
  let totalWeight = 0;
  // sample share accumulation
  samples.forEach((sample) => {
    totalWeight += sample.weight;
    // predicate guard
    if (predicate(sample)) {
      matchingWeight += sample.weight;
    }
  });
  return totalWeight ? matchingWeight / totalWeight : 0;
};

// route class inference
const getRouteClass = (
  samples: NormalizedCapacitySample[],
  scarceShare: number
): ForecastRouteClass => {
  const reservationShare = getWeightedShare(samples, (sample) => {
    return sample.hasReservations;
  });
  // reservation route guard
  if (reservationShare >= 0.25) {
    return "reservation";
  }
  // scarce route guard
  if (scarceShare >= 0.25) {
    return "high-variance";
  }
  return "standard";
};

// full risk band
const getFullRisk = (fullProbability: number): ForecastFullRisk => {
  // high full guard
  if (fullProbability > 0.8) {
    return "high";
  }
  // likely full guard
  if (fullProbability >= 0.5) {
    return "likely";
  }
  // unlikely full guard
  if (fullProbability >= 0.2) {
    return "unlikely";
  }
  return "low";
};

// reconcile candidate point and probability outputs
export const reconcileForecastCoherence = (
  estimate: CrossingEstimate,
  totalCapacity: number
): CrossingEstimate => {
  const availableCapacity = constrain(
    estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0),
    0,
    Math.max(0, totalCapacity)
  );
  let fullProbability = constrain(estimate.fullProbability ?? 0, 0, 1);
  const availableShare =
    totalCapacity > 0 ? availableCapacity / totalCapacity : 0;
  // enforce a full-sailing floor
  if (availableCapacity === 0) {
    fullProbability = Math.max(fullProbability, 0.5);
  }
  // exclude practical-full probability
  if (availableShare >= 0.1) {
    fullProbability = Math.min(fullProbability, 0.49);
  }
  // enforce ample-capacity probability
  if (availableShare > 0.35) {
    fullProbability = Math.min(fullProbability, 0.19);
  }
  fullProbability = round(fullProbability, 2);
  return {
    ...estimate,
    fullProbability,
    fullRisk: getFullRisk(fullProbability),
  };
};

// formatted count
const formatForecastCount = (count: number): string =>
  FORECAST_COUNT_FORMATTER.format(count);

// plural noun
const getForecastPlural = (count: number, singular: string): string =>
  count === 1 ? singular : `${singular}s`;

// database history summary
const getHistoricalRecordSummary = (
  crossings: Crossing[]
): HistoricalRecordSummary => {
  // empty history guard
  if (isEmpty(crossings)) {
    return { historyYears: 0, totalSailings: 0 };
  }
  const departureTimes = crossings.map((crossing) => {
    // crossing timestamp
    return crossing.departureTime;
  });
  const earliestDeparture = Math.min(...departureTimes);
  const latestDeparture = Math.max(...departureTimes);
  const historyYears = Math.max(
    1,
    Math.ceil((latestDeparture - earliestDeparture) / HISTORY_YEAR_SECONDS)
  );
  return {
    historyYears,
    totalSailings: crossings.length,
  };
};

// historical summary from range
const getHistoricalRecordSummaryFromRange = ({
  earliestDeparture,
  latestDeparture,
  totalSailings,
}: {
  earliestDeparture: number | null;
  latestDeparture: number | null;
  totalSailings: number;
}): HistoricalRecordSummary => {
  // empty history guard
  if (
    !totalSailings ||
    earliestDeparture === null ||
    latestDeparture === null
  ) {
    return { historyYears: 0, totalSailings };
  }
  const historyYears = Math.max(
    1,
    Math.ceil((latestDeparture - earliestDeparture) / HISTORY_YEAR_SECONDS)
  );
  return { historyYears, totalSailings };
};

// route history summary
const findHistoricalRecordSummary = async ({
  arrivalId,
  departureId,
}: {
  arrivalId: string;
  departureId: string;
}): Promise<HistoricalRecordSummary> => {
  const where = { arrivalId, departureId };
  const [totalSailings, earliestDeparture, latestDeparture] = await Promise.all(
    [
      Crossing.count({ where }),
      Crossing.min("departureTime", { where }) as Promise<number | null>,
      Crossing.max("departureTime", { where }) as Promise<number | null>,
    ]
  );
  return getHistoricalRecordSummaryFromRange({
    earliestDeparture,
    latestDeparture,
    totalSailings,
  });
};

// historical pattern detail
const getHistoricalPatternDetail = ({
  recordSummary,
  sampleSize,
}: {
  recordSummary: HistoricalRecordSummary;
  sampleSize: number;
}): string => {
  const sampleLabel = getForecastPlural(sampleSize, "sailing");
  const yearLabel = getForecastPlural(recordSummary.historyYears, "year");
  const totalLabel = getForecastPlural(recordSummary.totalSailings, "sailing");
  return `${formatForecastCount(
    sampleSize
  )} comparable past ${sampleLabel} are weighted by date, time, route, and vessel capacity. ${formatForecastCount(
    recordSummary.totalSailings
  )} total ${totalLabel} over ${formatForecastCount(
    recordSummary.historyYears
  )} ${yearLabel} recorded for this route.`;
};

// historical factor list
const getHistoricalForecastFactors = ({
  calibration,
  persistedCalibration,
  profile,
  recordSummary,
  sampleSize,
}: {
  calibration: PeakCalibration;
  persistedCalibration?: ForecastCalibration | null;
  profile: DemandProfile;
  recordSummary: HistoricalRecordSummary;
  sampleSize: number;
}): ForecastFactor[] => {
  const factors: ForecastFactor[] = [
    {
      detail: getHistoricalPatternDetail({ recordSummary, sampleSize }),
      impact: "neutral",
      label: "Historical pattern",
    },
  ];
  // school break factor
  if (profile.calendar.schoolBreakPressure > 0) {
    factors.push({
      detail: profile.schoolBreakName ?? "school break",
      impact: "higher",
      label: "Washington school break",
    });
  }
  // summer direction factor
  if (profile.calendar.summerWeekendPressure > 0) {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Summer weekend",
    });
  }
  // sports event factor
  if (profile.calendar.sportsEventPressure > 0) {
    factors.push({
      detail: profile.sportsTeamName ?? "Seattle team",
      impact: "higher",
      label: "Major Seattle home game",
    });
  }
  // holiday factor
  if (profile.isHolidayDate || profile.daysUntilHoliday === 1) {
    factors.push({
      detail: profile.holidayName ?? "holiday",
      impact: "higher",
      label: profile.isHolidayDate
        ? "Washington holiday"
        : "Day before Washington holiday",
    });
  } else if (profile.isHolidayWindow) {
    factors.push({
      detail: profile.holidayName ?? "holiday",
      impact: "higher",
      label: "Washington holiday travel window",
    });
  }
  // route class factor
  if (calibration.routeClass === "reservation") {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Reservation-heavy route",
    });
  } else if (calibration.routeClass === "high-variance") {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Less predictable terminal",
    });
  }
  const learnedBias = persistedCalibration?.fullBias ?? 1;
  // full risk factor
  if (calibration.fullRisk !== "low" || learnedBias >= 1.05) {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Full-boat spikes on this route",
    });
  }
  // peak factor
  if (calibration.shouldUsePeakCapacity) {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Busier than average pattern",
    });
  }
  return factors;
};

// route calibration
const getPeakCalibration = (
  samples: NormalizedCapacitySample[],
  profile: DemandProfile,
  targetTotalCapacity: number,
  persistedCalibration?: ForecastCalibration | null
): PeakCalibration => {
  const fullThreshold = Math.max(1, round(targetTotalCapacity * 0.02));
  const fullishThreshold = Math.max(4, round(targetTotalCapacity * 0.1));
  const scarceThreshold = Math.max(8, round(targetTotalCapacity * 0.2));
  const busyThreshold = Math.max(12, round(targetTotalCapacity * 0.35));
  const weightedFullShare = getWeightedShare(samples, (sample) => {
    return getAvailableCapacity(sample) <= fullThreshold;
  });
  const weightedFullishShare = getWeightedShare(samples, (sample) => {
    return getAvailableCapacity(sample) <= fullishThreshold;
  });
  const weightedScarceShare = getWeightedShare(samples, (sample) => {
    return getAvailableCapacity(sample) <= scarceThreshold;
  });
  const weightedBusyShare = getWeightedShare(samples, (sample) => {
    return getAvailableCapacity(sample) <= busyThreshold;
  });
  const routeClass = getRouteClass(samples, weightedScarceShare);
  let holidayPressure = 0;
  // holiday date pressure
  if (profile.isHolidayDate) {
    holidayPressure = 0.18;
  } else if (profile.daysUntilHoliday === 1) {
    // pre-holiday pressure
    holidayPressure = 0.12;
  } else if (profile.isHolidayWindow) {
    // nearby holiday pressure
    holidayPressure = 0.07;
  }
  const reservationPressure = routeClass === "reservation" ? 0.06 : 0;
  const variancePressure = routeClass === "high-variance" ? 0.08 : 0;
  const learnedPressure = constrain(
    (persistedCalibration?.fullBias ?? 1) - 1,
    -0.12,
    0.2
  );
  const demandPressure = constrain(
    weightedFullShare * 1.4 +
      weightedFullishShare * 0.6 +
      weightedScarceShare * 0.25 +
      weightedBusyShare * 0.1 +
      holidayPressure +
      profile.calendar.totalPressure +
      reservationPressure +
      variancePressure +
      learnedPressure,
    0,
    1
  );
  const fullProbability = round(
    constrain(
      weightedFullShare +
        weightedFullishShare * 0.35 +
        holidayPressure * weightedScarceShare +
        profile.calendar.totalPressure * 0.35 +
        variancePressure,
      0,
      1
    ),
    2
  );
  const weightedQuantile = constrain(0.5 - demandPressure * 0.35, 0.15, 0.5);
  return {
    demandPressure,
    fullProbability,
    fullRisk: getFullRisk(fullProbability),
    routeClass,
    shouldUsePeakCapacity:
      profile.isHolidayDate ||
      profile.daysUntilHoliday === 1 ||
      profile.calendar.totalPressure >= 0.1 ||
      demandPressure >= 0.35,
    weightedFullShare,
    weightedFullishShare,
    weightedQuantile,
  };
};

// availability split
const splitAvailableCapacity = (
  totalAvailable: number,
  samples: NormalizedCapacitySample[]
): CapacityPair => {
  const reservableShare = weightedMean(
    samples.map((sample) => {
      const availableCapacity = getAvailableCapacity(sample);
      return {
        value: availableCapacity
          ? (sample.reservableCapacity ?? 0) / availableCapacity
          : 0,
        weight: sample.weight,
      };
    })
  );
  const reservableCapacity = round(totalAvailable * reservableShare);
  return {
    driveUpCapacity: totalAvailable - reservableCapacity,
    reservableCapacity,
  };
};

// peak demand capacity
const getPeakDemandCapacity = (
  samples: NormalizedCapacitySample[],
  meanCapacity: CapacityPair,
  profile: DemandProfile,
  targetTotalCapacity: number,
  persistedCalibration?: ForecastCalibration | null
): CapacityPair & { calibration: PeakCalibration } => {
  const calibration = getPeakCalibration(
    samples,
    profile,
    targetTotalCapacity,
    persistedCalibration
  );
  // non-peak guard
  if (!calibration.shouldUsePeakCapacity) {
    return { ...meanCapacity, calibration };
  }
  const availableSamples = samples.map((sample) => ({
    value: getAvailableCapacity(sample),
    weight: sample.weight,
  }));
  const quantileAvailable = weightedQuantile(
    availableSamples,
    calibration.weightedQuantile
  );
  const meanAvailable = getAvailableCapacity(meanCapacity);
  let selectedAvailable = Math.min(meanAvailable, quantileAvailable);
  // full risk guard
  if (
    (calibration.fullRisk === "likely" || calibration.fullRisk === "high") &&
    calibration.weightedFullShare > 0 &&
    calibration.weightedFullishShare >= calibration.weightedFullShare
  ) {
    selectedAvailable = 0;
  }
  return {
    ...splitAvailableCapacity(round(selectedAvailable), samples),
    calibration,
  };
};

// constrain total capacity
const constrainCapacityPair = (
  capacity: CapacityPair,
  maxDriveUpCapacity: number,
  maxReservableCapacity: number,
  maxTotalCapacity: number
): CapacityPair => {
  const reservableCapacity = constrain(
    capacity.reservableCapacity ?? 0,
    0,
    maxReservableCapacity
  );
  const driveUpCapacity = constrain(
    capacity.driveUpCapacity,
    0,
    Math.min(maxDriveUpCapacity, maxTotalCapacity - reservableCapacity)
  );
  return { driveUpCapacity, reservableCapacity };
};

// forecasted occupied spaces
const getForecastedOccupiedCapacity = (
  capacity: CapacityPair,
  totalCapacity: number
): number => {
  const availableCapacity =
    capacity.driveUpCapacity + (capacity.reservableCapacity ?? 0);
  return constrain(totalCapacity - availableCapacity, 0, totalCapacity);
};

// cancelled demand rollover
const addCancelledRolloverDemand = (
  capacity: CapacityPair,
  rolloverDemand: number
): CapacityPair => {
  const roundedDemand = Math.max(0, round(rolloverDemand));
  const driveUpReduction = Math.min(capacity.driveUpCapacity, roundedDemand);
  const reservableReduction = Math.min(
    capacity.reservableCapacity ?? 0,
    roundedDemand - driveUpReduction
  );
  return {
    driveUpCapacity: capacity.driveUpCapacity - driveUpReduction,
    reservableCapacity:
      (capacity.reservableCapacity ?? 0) - reservableReduction,
  };
};

// format a signed target-space vehicle count
const formatDemandVehicleDelta = (
  occupiedShareDelta: number,
  targetTotalCapacity: number
): string => {
  const vehicles = round(occupiedShareDelta * targetTotalCapacity);
  return `${vehicles >= 0 ? "+" : ""}${vehicles} vehicles for this sailing's assigned capacity`;
};

// build demand-shock explanations
const getDemandShockFactors = (
  adjustment: DemandShockAdjustment,
  targetTotalCapacity: number,
  asOf: number,
  targetDepartureTime: number
): ForecastFactor[] => {
  const factors: ForecastFactor[] = [];
  // suppress cancelled component movement
  if (adjustment.occupiedShareDelta === 0) {
    return factors;
  }
  const { recentRegime } = adjustment;
  // explain a material recent regime
  if (recentRegime && Math.abs(recentRegime.occupiedShareDelta) >= 0.01) {
    factors.push({
      detail: `${recentRegime.sampleSize} sailings in the last 21 days; ${formatDemandVehicleDelta(
        recentRegime.occupiedShareDelta,
        targetTotalCapacity
      )}`,
      impact: recentRegime.occupiedShareDelta > 0 ? "higher" : "lower",
      label: "Recent route demand",
    });
  }
  const { sameDay } = adjustment;
  // explain a material same-day signal
  if (sameDay && Math.abs(sameDay.occupiedShareDelta) >= 0.01) {
    const hoursUntilTarget = Math.max(
      0,
      (targetDepartureTime - asOf) / (60 * 60)
    );
    factors.push({
      detail: `${sameDay.sampleSize} completed sailings today; ${formatDemandVehicleDelta(
        sameDay.occupiedShareDelta,
        targetTotalCapacity
      )} after ${round(hoursUntilTarget, 1)}h horizon decay`,
      impact: sameDay.occupiedShareDelta > 0 ? "higher" : "lower",
      label: "Sustained same-day demand",
    });
  }
  return factors;
};

// historical estimate
export const getHistoricalEstimate = (
  slotTime: DateTime,
  crossings: Crossing[],
  terminal: Terminal | null,
  now: DateTime,
  holidays: HolidayDateMap,
  targetTotalCapacity: number,
  route?: HistoricalRouteContext,
  areCrossingsComparable = false
): HistoricalEstimate | null => {
  const routeContext = route ?? {
    arrivalId: crossings[0]?.arrivalId ?? "",
    departureId: crossings[0]?.departureId ?? "",
  };
  const targetProfile = getCachedDemandProfile(
    slotTime,
    holidays,
    routeContext
  );
  // comparable reuse
  const comparableCrossings = areCrossingsComparable
    ? crossings
    : crossings.filter((crossing) =>
        isComparableCrossing(slotTime, crossing, now, holidays)
      );
  const samples: HistoricalSample[] = comparableCrossings.map((crossing) => ({
    crossing,
    driveUpCapacity: crossing.driveUpCapacity,
    reservableCapacity: crossing.reservableCapacity,
    weight: getSampleWeight(
      slotTime,
      crossing,
      terminal,
      holidays,
      targetProfile,
      routeContext
    ),
  }));

  // sample guard
  if (isEmpty(samples)) {
    return null;
  }

  const normalizedSamples = samples.map((sample) => {
    // normalize boat size
    return normalizeHistoricalSample(sample, targetTotalCapacity);
  });
  // emit an audit of the exact estimator input
  if (routeContext.onInputAudit) {
    routeContext.onInputAudit({
      arrivalId: routeContext.arrivalId,
      asOf: now.toSeconds(),
      departureId: routeContext.departureId,
      samples: normalizedSamples.map((sample, index) => {
        const crossing = comparableCrossings[index];
        const crossingId = (crossing as Crossing & { id?: number | string }).id;
        return {
          arrivalId: crossing.arrivalId,
          departureId: crossing.departureId,
          departureTime: crossing.departureTime,
          driveUpCapacity: crossing.driveUpCapacity,
          id: crossingId ?? null,
          normalizedDriveUpCapacity: sample.driveUpCapacity,
          normalizedReservableCapacity: sample.reservableCapacity,
          reservableCapacity: crossing.reservableCapacity,
          totalCapacity: crossing.totalCapacity,
          weight: sample.weight,
        };
      }),
      targetCapacity: targetTotalCapacity,
      targetDepartureTime: slotTime.toSeconds(),
    });
  }
  const demandShockAdjustment = routeContext.demandShock
    ? getDemandShockAdjustment({
        asOf: routeContext.demandShock.asOf,
        baseSamples: normalizedSamples,
        history: routeContext.demandShock.history,
        target: {
          arrivalId: routeContext.arrivalId,
          departureId: routeContext.departureId,
          departureTime: slotTime.toSeconds(),
          targetCapacity: targetTotalCapacity,
        },
      })
    : undefined;
  const estimationSamples = demandShockAdjustment
    ? shiftCapacitySamplesForDemand(
        normalizedSamples,
        demandShockAdjustment.occupiedShareDelta,
        targetTotalCapacity
      )
    : normalizedSamples;
  const meanCapacity = {
    driveUpCapacity: round(
      weightedMean(
        estimationSamples.map(({ driveUpCapacity, weight }) => ({
          value: driveUpCapacity,
          weight,
        }))
      )
    ),
    reservableCapacity: round(
      weightedMean(
        estimationSamples.map(({ reservableCapacity, weight }) => ({
          value: reservableCapacity ?? 0,
          weight,
        }))
      )
    ),
  };
  const demandCapacity = getPeakDemandCapacity(
    estimationSamples,
    meanCapacity,
    targetProfile,
    targetTotalCapacity,
    routeContext.calibration
  );
  const candidateFullProbability = routeContext.demandShock
    ? regularizeDemandShockProbability(
        routeContext.demandShock.baselineFullProbability,
        demandCapacity.calibration.fullProbability,
        demandShockAdjustment?.occupiedShareDelta ?? 0
      )
    : demandCapacity.calibration.fullProbability;
  const candidateCalibration = {
    ...demandCapacity.calibration,
    fullProbability: candidateFullProbability,
    fullRisk: getFullRisk(candidateFullProbability),
  };
  const candidateCapacity = demandShockAdjustment
    ? alignDemandShockPointEstimate(
        demandCapacity,
        candidateFullProbability,
        demandShockAdjustment.occupiedShareDelta,
        targetTotalCapacity
      )
    : demandCapacity;

  return {
    demandShockAdjustment,
    driveUpCapacity: candidateCapacity.driveUpCapacity,
    factors: [
      ...getHistoricalForecastFactors({
        calibration: candidateCalibration,
        persistedCalibration: routeContext.calibration,
        profile: targetProfile,
        recordSummary:
          routeContext.recordSummary ?? getHistoricalRecordSummary(crossings),
        sampleSize: samples.length,
      }),
      ...(demandShockAdjustment && routeContext.demandShock
        ? getDemandShockFactors(
            demandShockAdjustment,
            targetTotalCapacity,
            routeContext.demandShock.asOf,
            slotTime.toSeconds()
          )
        : []),
    ],
    fullProbability: candidateCalibration.fullProbability,
    fullRisk: candidateCalibration.fullRisk,
    reservableCapacity: candidateCapacity.reservableCapacity,
    routeClass: candidateCalibration.routeClass,
    sampleSize: samples.length,
    weight: round(
      samples.reduce((total, { weight }) => total + weight, 0),
      2
    ),
  };
};

// live blend weight
const getLiveWeight = (slotTime: DateTime, now: DateTime): number => {
  const hoursUntilDeparture = slotTime.diff(now, "hours").hours;
  // imminent sailing
  if (hoursUntilDeparture <= 0.5) {
    return 0.8;
  }
  // near-term sailing
  if (hoursUntilDeparture <= 2) {
    return 0.65;
  }
  return 0.45;
};

// stale capacity check
const hasStaleCapacityReport = (crossing: Crossing, now: DateTime): boolean => {
  // missing timestamp guard
  if (!crossing.capacityReportUpdatedAt) {
    return true;
  }
  const reportAgeSeconds = now.toSeconds() - crossing.capacityReportUpdatedAt;
  return reportAgeSeconds > CAPACITY_REPORT_STALE_SECONDS;
};

// shared live-capacity guards
const shouldClassifyFullLiveCapacity = (
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime
): boolean => {
  // missing crossing guard
  if (!crossing) {
    return false;
  }
  // passed sailing guard
  if (slotTime <= now) {
    return false;
  }
  // disruption guard
  if (crossing.isCancelled) {
    return false;
  }
  return true;
};

// retain pre-rollout placeholder behavior
export const isUninformativeFullLiveCapacityLegacy = (
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime,
  totalCapacity: number
): boolean => {
  // preserve shared guards
  if (!shouldClassifyFullLiveCapacity(crossing, slotTime, now)) {
    return false;
  }
  const hoursUntilDeparture = slotTime.diff(now, "hours").hours;
  const isOpenPlaceholder =
    getAvailableCapacity(crossing as Crossing) >= totalCapacity &&
    hoursUntilDeparture > LEGACY_EARLY_PLACEHOLDER_CAPACITY_HOURS;
  // early placeholder guard
  if (isOpenPlaceholder) {
    return true;
  }
  return (
    getAvailableCapacity(crossing as Crossing) >= totalCapacity &&
    hasStaleCapacityReport(crossing as Crossing, now)
  );
};

// classify using durable reporting state
export const isUninformativeFullLiveCapacityStateful = (
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime,
  totalCapacity: number
): boolean => {
  // preserve shared guards
  if (!shouldClassifyFullLiveCapacity(crossing, slotTime, now)) {
    return false;
  }
  const liveCrossing = crossing as Crossing;
  // preserve partial live reports
  if (getAvailableCapacity(liveCrossing) < totalCapacity) {
    return false;
  }
  // suppress never-started placeholders
  if (!Number.isFinite(liveCrossing.capacityReportingStartedAt)) {
    return true;
  }
  return hasStaleCapacityReport(liveCrossing, now);
};

// select the independent capacity classifier
export const selectUninformativeFullLiveCapacityClassifier = (
  gate: CapacityReportingGate
): typeof isUninformativeFullLiveCapacityStateful =>
  gate === "on"
    ? isUninformativeFullLiveCapacityStateful
    : isUninformativeFullLiveCapacityLegacy;

// blend capacities
export const blendCapacity = (
  historical: HistoricalEstimate | null,
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime,
  totalCapacity: number,
  gate: CapacityReportingGate = getCapacityReportingGate()
): CapacityPair | null => {
  // stale live guard
  if (
    (gate === "on" || historical) &&
    selectUninformativeFullLiveCapacityClassifier(gate)(
      crossing,
      slotTime,
      now,
      totalCapacity
    )
  ) {
    return historical;
  }
  // historical fallback
  if (!crossing) {
    return historical;
  }
  const live: CapacityPair = {
    driveUpCapacity: crossing.driveUpCapacity,
    reservableCapacity: crossing.reservableCapacity,
  };
  // live-only fallback
  if (!historical) {
    return live;
  }
  const liveWeight = getLiveWeight(slotTime, now);
  const historyWeight = 1 - liveWeight;
  return {
    driveUpCapacity: Math.min(
      live.driveUpCapacity,
      round(
        live.driveUpCapacity * liveWeight +
          historical.driveUpCapacity * historyWeight
      )
    ),
    reservableCapacity: Math.min(
      live.reservableCapacity ?? 0,
      round(
        (live.reservableCapacity ?? 0) * liveWeight +
          (historical.reservableCapacity ?? 0) * historyWeight
      )
    ),
  };
};

// lowest tide level
const getLowestTideLevel = (
  departureTide?: TideConditions,
  arrivalTide?: TideConditions
): number | null => {
  const levels = [departureTide?.waterLevelM, arrivalTide?.waterLevelM].filter(
    (level): level is number => typeof level === "number"
  );
  // missing tide guard
  if (levels.length === 0) {
    return null;
  }
  return Math.min(...levels);
};

// slot tide contract
const getSlotTide = (
  departureTide?: TideConditions,
  arrivalTide?: TideConditions
): SlotTide | undefined => {
  // missing tide guard
  if (!departureTide && !arrivalTide) {
    return undefined;
  }
  const fallbackTide = departureTide ?? arrivalTide;
  return {
    arrivalStationId: arrivalTide?.stationId,
    arrivalWaterLevelM: arrivalTide?.waterLevelM,
    lowestWaterLevelM: getLowestTideLevel(departureTide, arrivalTide),
    stationId: fallbackTide?.stationId ?? "",
    waterLevelM: departureTide?.waterLevelM ?? null,
  };
};

// daily high temperature
const getHighTemperatureC = (
  forecastsByHour: Map<number, WeatherConditions> | undefined
): number | null => {
  const temperatures = Array.from(forecastsByHour?.values() ?? [])
    .map((weather) => weather.temperatureC)
    .filter((temperature): temperature is number => temperature !== null);
  // missing temperature guard
  if (!temperatures.length) {
    return null;
  }
  return Math.max(...temperatures);
};

// slot weather contract
const getSlotWeather = (
  weather: WeatherConditions | undefined,
  highTemperatureC: number | null
): SlotWeather | undefined => {
  // missing weather guard
  if (!weather) {
    return undefined;
  }
  return {
    cloudCoverPercent: weather.cloudCoverPercent,
    highTemperatureC,
    precipitationMm: weather.precipitationMm,
    temperatureC: weather.temperatureC,
    windGustKmh: weather.windGustKmh,
    windSpeedKmh: weather.windSpeedKmh,
  };
};

// disrupted sailing check
const isDisrupted = (crossing: Crossing | undefined): boolean => {
  // missing crossing guard
  if (!crossing) {
    return false;
  }
  return (
    crossing.isCancelled ||
    Math.abs(crossing.departureDelta ?? 0) >= DELAY_DISRUPTION_SECONDS
  );
};

// confidence level
const getConfidence = (
  historical: HistoricalEstimate | null,
  crossing: Crossing | undefined,
  disrupted: boolean
): ForecastConfidence => {
  // disruption guard
  if (disrupted) {
    return "low";
  }
  // strong signal guard
  if (crossing && (historical?.sampleSize ?? 0) >= 5) {
    return "high";
  }
  // medium signal guard
  if (crossing || (historical?.sampleSize ?? 0) >= 3) {
    return "medium";
  }
  return "low";
};

// estimate source
const getSource = (
  historical: HistoricalEstimate | null,
  crossing: Crossing | undefined,
  disrupted: boolean
): CrossingEstimate["source"] => {
  // disruption source
  if (disrupted) {
    return "disruption";
  }
  // blended source
  if (historical && crossing) {
    return "blended";
  }
  // live source
  if (crossing) {
    return "live";
  }
  return "historical";
};

// fahrenheit temperature
const getFahrenheitTemperature = (temperatureC: number): number =>
  Math.round((temperatureC * 9) / 5 + 32);

// mph wind speed
const getMphWindSpeed = (windSpeedKmh: number): number =>
  Math.round(windSpeedKmh * 0.621371);

// temperature copy
const getTemperatureText = (highTemperatureC: number | null): string => {
  // missing temperature guard
  if (highTemperatureC === null) {
    return "high unavailable";
  }
  return `${getFahrenheitTemperature(highTemperatureC)}°F high`;
};

// cloud cover copy
const getCloudCoverText = (cloudCoverPercent: number | null): string => {
  // missing cloud cover guard
  if (cloudCoverPercent === null) {
    return "cloud cover unavailable";
  }
  const roundedCloudCoverPercent = Math.round(cloudCoverPercent);
  // clear sky guard
  if (roundedCloudCoverPercent === 0) {
    return "clear";
  }
  return `${roundedCloudCoverPercent}% cover`;
};

// precipitation copy
const getPrecipitationText = (precipitationMm: number | null): string => {
  // missing precipitation guard
  if (precipitationMm === null) {
    return "precipitation unavailable";
  }
  const precipitationInches = precipitationMm / 25.4;
  // dry precipitation guard
  if (precipitationInches < 0.01) {
    return "None";
  }
  return `${precipitationInches.toFixed(2)} in`;
};

// wind detail copy
const getWindText = (weather: SlotWeather): string => {
  // missing wind guard
  if (weather.windSpeedKmh === null) {
    return "wind unavailable";
  }
  const windSpeedMph = getMphWindSpeed(weather.windSpeedKmh);
  // missing gust guard
  if (weather.windGustKmh === null) {
    return `${windSpeedMph} mph wind`;
  }
  const gustSpeedMph = getMphWindSpeed(weather.windGustKmh);
  const lowWindMph = Math.min(windSpeedMph, gustSpeedMph);
  const highWindMph = Math.max(windSpeedMph, gustSpeedMph);
  // flat wind guard
  if (lowWindMph === highWindMph) {
    return `${lowWindMph} mph wind`;
  }
  return `${lowWindMph}-${highWindMph} mph wind`;
};

// weather detail copy
const getWeatherForecastText = (weather: SlotWeather | undefined): string => {
  // missing weather guard
  if (!weather) {
    return "forecast unavailable";
  }
  return [
    getTemperatureText(weather.highTemperatureC),
    getCloudCoverText(weather.cloudCoverPercent),
    getPrecipitationText(weather.precipitationMm),
    getWindText(weather),
  ].join(", ");
};

// tide detail copy
const getTideForecastText = (slot: Slot): string => {
  const tideLevel = slot.tide?.lowestWaterLevelM;
  // missing tide guard
  if (tideLevel === null || tideLevel === undefined) {
    return "tide forecast unavailable";
  }
  return `${formatFeetBelowAverageLowTide(
    tideLevel
  )} below the average low tide`;
};

// delay detail copy
const getDelayForecastText = (
  crossing: { departureDelta?: number | null } | undefined
): string => {
  const delaySeconds = crossing?.departureDelta;
  // missing delay guard
  if (!delaySeconds) {
    return "delay unavailable";
  }
  return `${Math.round(Math.abs(delaySeconds) / 60)} mins late`;
};

// operational factor list
const getOperationalForecastFactors = ({
  adjusted,
  blended,
  cancelledRunLabels,
  departureTerminalId,
  disrupted,
  forecastCrossing,
  historical,
  liveIsUninformative,
  rolloverDemand,
  slot,
}: {
  adjusted: CapacityPair;
  blended: CapacityPair;
  cancelledRunLabels: string[];
  departureTerminalId: string;
  disrupted: boolean;
  forecastCrossing: Crossing | undefined;
  historical: HistoricalEstimate | null;
  liveIsUninformative: boolean;
  rolloverDemand: number;
  slot: Slot;
}): ForecastFactor[] => {
  const factors = [...(historical?.factors ?? [])];
  // live blend guard
  if (forecastCrossing && historical) {
    factors.push({
      detail: "",
      impact: "neutral",
      label: "Current WSF vehicle-space report data included",
    });
  } else if (forecastCrossing) {
    factors.push({
      detail: "",
      impact: "higher",
      label: "Only the current WSF vehicle-space report is available.",
    });
  } else if (liveIsUninformative) {
    factors.push({
      detail: "",
      impact: "neutral",
      label: "No reported capacity data yet",
    });
  } else {
    factors.push({
      detail: "",
      impact: "neutral",
      label: "Current WSF vehicle-space report data not available",
    });
  }
  const weatherDelta =
    getAvailableCapacity(adjusted) - getAvailableCapacity(blended);
  const weatherText = getWeatherForecastText(slot.weather);
  // weather factor guard
  if (weatherDelta !== 0) {
    factors.push({
      detail: weatherText,
      impact: weatherDelta < 0 ? "higher" : "lower",
      label: weatherDelta < 0 ? "Good weather traffic" : "Bad weather traffic",
    });
  } else if (slot.weather) {
    factors.push({
      detail: weatherText,
      impact: "neutral",
      label: "No weather impact",
    });
  }
  const tidalCancellationRisk = getTidalCancellationRisk({
    departureTerminalId,
    slot,
  });
  const tideText = getTideForecastText(slot);
  // tide factor guard
  if (
    slot.tide?.lowestWaterLevelM !== null &&
    slot.tide?.lowestWaterLevelM !== undefined
  ) {
    factors.push({
      detail: tideText,
      impact: tidalCancellationRisk ? "higher" : "lower",
      label: tidalCancellationRisk
        ? "Tidal cancellation risk"
        : "No tidal cancellation risk",
    });
  }
  // disruption factor guard
  if (disrupted && (slot.crossing?.departureDelta ?? 0) !== 0) {
    factors.push({
      detail: getDelayForecastText(slot.crossing),
      impact: "higher",
      label: "Sailing delayed",
    });
  }
  // rollover factor guard
  if (rolloverDemand > 0) {
    factors.push({
      detail: cancelledRunLabels.join(", "),
      impact: "higher",
      label: "High demand due to previous cancellation",
    });
  }
  return factors;
};

// collect holiday years
const getHolidayYears = (
  schedule: Schedule,
  crossings: Crossing[]
): number[] => {
  const years = new Set<number>();
  // schedule year collection
  schedule.slots.forEach((slot) => {
    years.add(DateTime.fromSeconds(slot.time).year);
  });
  // crossing year collection
  crossings.forEach((crossing) => {
    years.add(DateTime.fromSeconds(crossing.departureTime).year);
  });
  return Array.from(years);
};

// load holiday dates
const getHolidayDateMap = async (
  schedule: Schedule,
  crossings: Crossing[]
): Promise<HolidayDateMap> => {
  const holidayEntries = await Promise.all(
    getHolidayYears(schedule, crossings).map(
      async (year): Promise<[number, Set<string>]> => [
        year,
        await getWashingtonHolidayDates(year),
      ]
    )
  );
  return Object.fromEntries(holidayEntries) as HolidayDateMap;
};

// missing optional table check
const isMissingOptionalTableError = (error: unknown): boolean => {
  const typedError = error as { parent?: { code?: string } };
  return typedError.parent?.code === "42P01";
};

// load demand events safely
const findDemandEvents = async (
  startTime: number,
  endTime: number
): Promise<DemandEvent[]> => {
  try {
    return await DemandEvent.findAll({
      where: {
        startsAt: {
          [Op.gte]: startTime,
          [Op.lte]: endTime,
        },
      },
    });
  } catch (error) {
    // optional migration guard
    if (isMissingOptionalTableError(error)) {
      logger.info("Skipping demand events; table is not migrated yet");
      return [];
    }
    throw error;
  }
};

// load calibrations safely
const findForecastCalibrations = async (
  departureId: string,
  arrivalId: string
): Promise<Map<string, ForecastCalibration>> => {
  try {
    const calibrations = await ForecastCalibration.findAll({
      order: [["year", "DESC"]],
      where: {
        arrivalId,
        departureId,
      },
    });
    const calibrationByDaypart = new Map<string, ForecastCalibration>();
    // newest calibration wins
    calibrations.forEach((calibration) => {
      // duplicate daypart guard
      if (!calibrationByDaypart.has(calibration.daypart)) {
        calibrationByDaypart.set(calibration.daypart, calibration);
      }
    });
    return calibrationByDaypart;
  } catch (error) {
    // optional migration guard
    if (isMissingOptionalTableError(error)) {
      logger.info("Skipping forecast calibration; table is not migrated yet");
      return new Map();
    }
    throw error;
  }
};

// yield forecast work
const yieldEstimateRefresh = (): Promise<void> => waitForImmediate();

interface SlotForecastPipelineResult {
  coherenceRewritten: boolean;
  estimate: CrossingEstimate;
  nextRolloverDemand: number;
  preCoherenceProbability: number;
}

interface ForecastTelemetry {
  acceptedAllOpenRows: number;
  appliedRecentRegimeSignals: number;
  appliedSameDaySignals: number;
  appliedSignals: number;
  cappedSignals: number;
  coherenceRewrites: number;
  eligibleRecentRegimeSignals: number;
  eligibleSameDaySignals: number;
  maxAbsoluteSpaces: number;
  probabilityAfter: [number, number, number, number];
  probabilityBefore: [number, number, number, number];
  staleAllOpenRows: number;
  suppressedAllOpenRows: number;
  totalAbsoluteSpaces: number;
}

// create aggregate-only telemetry state
const createForecastTelemetry = (): ForecastTelemetry => ({
  acceptedAllOpenRows: 0,
  appliedRecentRegimeSignals: 0,
  appliedSameDaySignals: 0,
  appliedSignals: 0,
  cappedSignals: 0,
  coherenceRewrites: 0,
  eligibleRecentRegimeSignals: 0,
  eligibleSameDaySignals: 0,
  maxAbsoluteSpaces: 0,
  probabilityAfter: [0, 0, 0, 0],
  probabilityBefore: [0, 0, 0, 0],
  staleAllOpenRows: 0,
  suppressedAllOpenRows: 0,
  totalAbsoluteSpaces: 0,
});

// map one probability to an aggregate bin
const getProbabilityBin = (probability: number): 0 | 1 | 2 | 3 => {
  // low bin
  if (probability < 0.2) {
    return 0;
  }
  // moderate bin
  if (probability < 0.5) {
    return 1;
  }
  // likely bin
  if (probability <= 0.8) {
    return 2;
  }
  return 3;
};

// record aggregate candidate evidence
const recordCandidateTelemetry = (
  telemetry: ForecastTelemetry,
  historical: HistoricalEstimate | null,
  result: SlotForecastPipelineResult,
  totalCapacity: number
): void => {
  const adjustment = historical?.demandShockAdjustment;
  // record recent-regime eligibility
  if (adjustment?.recentRegime) {
    telemetry.eligibleRecentRegimeSignals += 1;
    // record material recent-regime movement
    if (
      Math.abs(adjustment.recentRegime.occupiedShareDelta) >=
      MIN_TELEMETRY_COMPONENT_DELTA
    ) {
      telemetry.appliedRecentRegimeSignals += 1;
    }
  }
  // record same-day eligibility
  if (adjustment?.sameDay) {
    telemetry.eligibleSameDaySignals += 1;
    // record material same-day movement
    if (
      Math.abs(adjustment.sameDay.occupiedShareDelta) >=
      MIN_TELEMETRY_COMPONENT_DELTA
    ) {
      telemetry.appliedSameDaySignals += 1;
    }
  }
  // record applied signal magnitude
  if (adjustment && adjustment.occupiedShareDelta !== 0) {
    telemetry.appliedSignals += 1;
    const absoluteSpaces = Math.abs(
      adjustment.occupiedShareDelta * totalCapacity
    );
    telemetry.totalAbsoluteSpaces += absoluteSpaces;
    telemetry.maxAbsoluteSpaces = Math.max(
      telemetry.maxAbsoluteSpaces,
      absoluteSpaces
    );
    const componentTotal =
      (adjustment.recentRegime?.occupiedShareDelta ?? 0) +
      (adjustment.sameDay?.occupiedShareDelta ?? 0);
    // record combined caps
    if (Math.abs(componentTotal) > 0.25 + Number.EPSILON) {
      telemetry.cappedSignals += 1;
    }
  }
  // record coherence changes
  if (result.coherenceRewritten) {
    telemetry.coherenceRewrites += 1;
  }
  telemetry.probabilityBefore[
    getProbabilityBin(result.preCoherenceProbability)
  ] += 1;
  telemetry.probabilityAfter[
    getProbabilityBin(result.estimate.fullProbability ?? 0)
  ] += 1;
};

// build one complete slot pipeline
const buildSlotForecast = async ({
  capacityGate,
  cancelledRunLabels,
  departureTerminalId,
  disrupted,
  forecastCrossing,
  historical,
  liveIsUninformative,
  now,
  reconcile,
  rolloverDemand,
  slot,
  slotTime,
  terminal,
  totalCapacity,
  weatherAdjustmentContext,
}: {
  capacityGate: CapacityReportingGate;
  cancelledRunLabels: string[];
  departureTerminalId: string;
  disrupted: boolean;
  forecastCrossing: Crossing | undefined;
  historical: HistoricalEstimate | null;
  liveIsUninformative: boolean;
  now: DateTime;
  reconcile: boolean;
  rolloverDemand: number;
  slot: Slot;
  slotTime: DateTime;
  terminal: Terminal | null;
  totalCapacity: number;
  weatherAdjustmentContext: Awaited<
    ReturnType<typeof createWeatherAdjustmentContext>
  >;
}): Promise<SlotForecastPipelineResult | null> => {
  const blended = blendCapacity(
    historical,
    forecastCrossing,
    slotTime,
    now,
    totalCapacity,
    capacityGate
  );
  const liveDriveCapacity = slot.crossing?.driveUpCapacity ?? totalCapacity;
  const liveReservableCapacity =
    slot.crossing?.reservableCapacity ?? totalCapacity;
  // require one forecast source
  if (!blended) {
    return null;
  }
  let adjusted = blended;
  // apply weather only before departure
  if (!slot.hasPassed) {
    adjusted = await getWeatherAdjustedCapacity({
      capacity: blended,
      context: weatherAdjustmentContext,
      liveCapacity: {
        driveUpCapacity: liveDriveCapacity,
        reservableCapacity: liveReservableCapacity,
      },
      slotTime,
      terminal,
    });
  }
  const constrained = constrainCapacityPair(
    adjusted,
    liveDriveCapacity,
    liveReservableCapacity,
    totalCapacity
  );
  let rolloverAdjusted = constrained;
  let nextRolloverDemand = rolloverDemand;
  // consume active rollover demand
  if (rolloverDemand > 0 && !slot.crossing?.isCancelled) {
    rolloverAdjusted = addCancelledRolloverDemand(constrained, rolloverDemand);
    nextRolloverDemand = 0;
  }
  let estimate: CrossingEstimate = {
    confidence: getConfidence(historical, forecastCrossing, disrupted),
    driveUpCapacity: rolloverAdjusted.driveUpCapacity,
    factors: getOperationalForecastFactors({
      adjusted,
      blended,
      cancelledRunLabels,
      departureTerminalId,
      disrupted,
      forecastCrossing,
      historical,
      liveIsUninformative,
      rolloverDemand,
      slot,
    }),
    fullProbability: historical?.fullProbability ?? 0,
    fullRisk: historical?.fullRisk ?? "low",
    reservableCapacity: rolloverAdjusted.reservableCapacity,
    routeClass: historical?.routeClass ?? "standard",
    sampleSize: historical?.sampleSize ?? 0,
    source: getSource(historical, forecastCrossing, disrupted),
  };
  const preCoherenceProbability = estimate.fullProbability ?? 0;
  // reconcile only a live candidate
  if (reconcile && !slot.crossing?.isCancelled) {
    estimate = reconcileForecastCoherence(estimate, totalCapacity);
  }
  const coherenceRewritten =
    preCoherenceProbability !== (estimate.fullProbability ?? 0) ||
    (historical?.fullRisk ?? "low") !== estimate.fullRisk;
  // preserve cancelled live capacity
  if (slot.crossing?.isCancelled) {
    nextRolloverDemand +=
      getForecastedOccupiedCapacity(constrained, totalCapacity) *
      CANCELLED_CAPACITY_ROLLOVER_SHARE;
    estimate.driveUpCapacity = slot.crossing.driveUpCapacity;
    estimate.reservableCapacity = slot.crossing.reservableCapacity;
  }
  return {
    coherenceRewritten,
    estimate,
    nextRolloverDemand,
    preCoherenceProbability,
  };
};

// exported functions

export const updateEstimates = async (
  schedules: Schedule[] = values(Schedule.getAll())
): Promise<void> => {
  const startedAt = Date.now();
  const now = DateTime.local();
  const capacityGate = getCapacityReportingGate();
  const demandShockMode = getDemandShockMode();
  const capacityClassifier =
    selectUninformativeFullLiveCapacityClassifier(capacityGate);
  const telemetry = createForecastTelemetry();
  // schedule estimate queue
  for (const schedule of schedules) {
    await yieldEstimateRefresh();
    // empty schedule guard
    if (isEmpty(schedule.slots)) {
      continue;
    }
    const firstTime = schedule.slots[0]?.time;
    const lastTime =
      schedule.slots[schedule.slots.length - 1]?.time ?? firstTime;
    const startTime = DateTime.fromSeconds(firstTime)
      .minus({ years: ESTIMATE_COMPOSITE_YEARS })
      .toSeconds();
    const terminal = Terminal.getByIndex(schedule.terminalId);
    const crossingWhere = {
      departureId: schedule.terminalId,
      arrivalId: schedule.mateId,
    };
    const [crossings, historicalRecordSummary] = await Promise.all([
      Crossing.findAll({
        where: {
          ...crossingWhere,
          departureTime: { [Op.gte]: startTime },
        },
      }),
      findHistoricalRecordSummary(crossingWhere),
    ]);
    const demandEvents = await findDemandEvents(
      startTime,
      DateTime.fromSeconds(lastTime).plus({ days: 1 }).toSeconds()
    );
    const persistedCalibrations = await findForecastCalibrations(
      schedule.terminalId,
      schedule.mateId
    );
    const holidays = await getHolidayDateMap(schedule, crossings);
    const historicalCandidates = getHistoricalCrossingCandidates(
      crossings,
      now,
      holidays
    );
    const demandShockHistory =
      demandShockMode === "off"
        ? null
        : createDemandShockHistoryIndex(crossings);
    const demandProfileCache = new Map<number, DemandProfile>();
    const sampleWeightCache = new Map<string, number>();

    const slotTimes = schedule.slots.map((slot) =>
      DateTime.fromSeconds(slot.time)
    );
    const weatherAdjustmentContext = await createWeatherAdjustmentContext({
      now,
      schedule,
      slotTimes,
      terminal,
    });
    const highTemperatureC = getHighTemperatureC(
      weatherAdjustmentContext?.forecastsByHour
    );
    const tideForecastContexts = new Map<
      string,
      Awaited<ReturnType<typeof createTideForecastContext>>
    >();
    const tideTerminalIds = Array.from(
      new Set([
        schedule.terminalId,
        ...schedule.slots.map((slot) => slot.mateId),
      ])
    );
    // tide terminal contexts
    for (const terminalId of tideTerminalIds) {
      tideForecastContexts.set(
        terminalId,
        await createTideForecastContext({
          slotTimes,
          terminalId,
        })
      );
    }

    let baselineRolloverDemand = 0;
    let candidateRolloverDemand = 0;
    const cancelledRunLabels: string[] = [];
    // estimate slots sequentially for cancellation spillover
    for (const [index, slot] of schedule.slots.entries()) {
      await yieldEstimateRefresh();
      const slotTime = slotTimes[index];
      const slotWeather = weatherAdjustmentContext?.forecastsByHour.get(
        slotTime.startOf("hour").toSeconds()
      );
      slot.weather = getSlotWeather(slotWeather, highTemperatureC);
      const tideHour = slotTime.startOf("hour").toSeconds();
      const departureTide = tideForecastContexts
        .get(schedule.terminalId)
        ?.forecastsByHour.get(tideHour);
      const arrivalTide = tideForecastContexts
        .get(slot.mateId)
        ?.forecastsByHour.get(tideHour);
      slot.tide = getSlotTide(departureTide, arrivalTide);
      const totalCapacity =
        slot.crossing?.totalCapacity ?? getSlotVehicleCapacity(slot);
      const liveIsUninformative = capacityClassifier(
        slot.crossing,
        slotTime,
        now,
        totalCapacity
      );
      const isClassifiableAllOpen =
        Boolean(slot.crossing) &&
        slotTime > now &&
        !slot.crossing?.isCancelled &&
        getAvailableCapacity(slot.crossing as Crossing) >= totalCapacity;
      const daypart = getForecastDaypart(slotTime);
      const persistedCalibration =
        persistedCalibrations.get(daypart) ?? persistedCalibrations.get("all");
      const comparableCrossings = getComparableCrossingsFromCandidates(
        slotTime,
        historicalCandidates,
        holidays
      );
      const routeContext: HistoricalRouteContext = {
        arrivalId: schedule.mateId,
        calibration: persistedCalibration,
        demandProfileCache,
        departureId: schedule.terminalId,
        events: demandEvents,
        recordSummary: historicalRecordSummary,
        sampleWeightCache,
      };
      const baselineHistorical = getHistoricalEstimate(
        slotTime,
        comparableCrossings,
        terminal,
        now,
        holidays,
        totalCapacity,
        routeContext,
        true
      );
      const shouldSuppressLiveCrossing =
        liveIsUninformative &&
        (capacityGate === "on" || Boolean(baselineHistorical));
      // record actual all-open handling
      if (isClassifiableAllOpen) {
        // record suppressed rows
        if (shouldSuppressLiveCrossing) {
          telemetry.suppressedAllOpenRows += 1;
          // record stale established rows
          if (
            Number.isFinite(slot.crossing?.capacityReportingStartedAt) &&
            hasStaleCapacityReport(slot.crossing as Crossing, now)
          ) {
            telemetry.staleAllOpenRows += 1;
          }
        } else {
          telemetry.acceptedAllOpenRows += 1;
        }
      }
      const forecastCrossing = shouldSuppressLiveCrossing
        ? undefined
        : slot.crossing;
      const disrupted = isDisrupted(slot.crossing);
      const activeCancelledRunLabels = [...cancelledRunLabels];
      const baselineResult = await buildSlotForecast({
        cancelledRunLabels: activeCancelledRunLabels,
        capacityGate,
        departureTerminalId: schedule.terminalId,
        disrupted,
        forecastCrossing,
        historical: baselineHistorical,
        liveIsUninformative,
        now,
        reconcile: false,
        rolloverDemand: baselineRolloverDemand,
        slot,
        slotTime,
        terminal,
        totalCapacity,
        weatherAdjustmentContext,
      });
      // baseline availability guard
      if (!baselineResult) {
        continue;
      }
      baselineRolloverDemand = baselineResult.nextRolloverDemand;
      const activeCandidateRolloverDemand = candidateRolloverDemand;
      const modeResult = await runDemandShockMode(
        demandShockMode,
        baselineResult,
        async () => {
          const candidateHistorical = getHistoricalEstimate(
            slotTime,
            comparableCrossings,
            terminal,
            now,
            holidays,
            totalCapacity,
            {
              ...routeContext,
              demandShock: {
                asOf: now.toSeconds(),
                baselineFullProbability:
                  baselineHistorical?.fullProbability ?? 0,
                history: demandShockHistory ?? [],
              },
            },
            true
          );
          const candidateForecastCrossing = shouldSuppressLiveCrossing
            ? undefined
            : slot.crossing;
          const candidateResult = await buildSlotForecast({
            cancelledRunLabels: activeCancelledRunLabels,
            capacityGate,
            departureTerminalId: schedule.terminalId,
            disrupted,
            forecastCrossing: candidateForecastCrossing,
            historical: candidateHistorical,
            liveIsUninformative,
            now,
            reconcile: true,
            rolloverDemand: activeCandidateRolloverDemand,
            slot,
            slotTime,
            terminal,
            totalCapacity,
            weatherAdjustmentContext,
          });
          // enforce paired candidate construction
          if (!candidateResult) {
            throw new Error(
              "Forecast candidate invariant failed after baseline construction"
            );
          }
          recordCandidateTelemetry(
            telemetry,
            candidateHistorical,
            candidateResult,
            totalCapacity
          );
          return candidateResult;
        }
      );
      // advance the private candidate rollover
      if (modeResult.candidate) {
        candidateRolloverDemand = modeResult.candidate.nextRolloverDemand;
      }
      // record cancelled labels once
      if (slot.crossing?.isCancelled) {
        cancelledRunLabels.push(slotTime.toFormat("h:mm a"));
      }
      slot.estimate = modeResult.selected.estimate;
    }
  }
  const meanAbsoluteSpaces = telemetry.appliedSignals
    ? telemetry.totalAbsoluteSpaces / telemetry.appliedSignals
    : 0;
  logger.info(
    formatLogBlock("Forecast update complete", [
      {
        heading: "runtime",
        lines: [
          `capacity reporting gate: ${capacityGate}`,
          `demand shock mode: ${demandShockMode}`,
          `elapsed milliseconds: ${Date.now() - startedAt}`,
        ],
      },
      {
        heading: "capacity reports",
        lines: [
          `suppressed all-open rows: ${telemetry.suppressedAllOpenRows}`,
          `accepted all-open rows: ${telemetry.acceptedAllOpenRows}`,
          `stale all-open rows: ${telemetry.staleAllOpenRows}`,
        ],
      },
      {
        heading: "demand signals",
        lines: [
          `recent-regime eligible/applied: ${telemetry.eligibleRecentRegimeSignals}/${telemetry.appliedRecentRegimeSignals}`,
          `same-day eligible/applied: ${telemetry.eligibleSameDaySignals}/${telemetry.appliedSameDaySignals}`,
          `applied targets: ${telemetry.appliedSignals}`,
          `capped targets: ${telemetry.cappedSignals}`,
          `mean absolute spaces: ${round(meanAbsoluteSpaces, 2)}`,
          `max absolute spaces: ${round(telemetry.maxAbsoluteSpaces, 2)}`,
        ],
      },
      {
        heading: "candidate coherence",
        lines: [
          `rewrites: ${telemetry.coherenceRewrites}`,
          `probability bins before: ${telemetry.probabilityBefore.join("/")}`,
          `probability bins after: ${telemetry.probabilityAfter.join("/")}`,
        ],
      },
    ])
  );
};
