import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import {
  CrossingEstimate,
  ForecastConfidence,
  type ForecastFullRisk,
  type ForecastRouteClass,
  Slot,
  type SlotTide,
  type SlotWeather,
} from "shared/contracts/schedules";
import { isEmpty } from "shared/lib/arrays";
import { constrain, round } from "shared/lib/math";
import { values } from "shared/lib/objects";

import { getWashingtonHolidayDates } from "~/lib/holidays";
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
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const ESTIMATE_COMPOSITE_YEARS = 2;
const DELAY_DISRUPTION_SECONDS = 15 * 60;
const CANCELLED_CAPACITY_ROLLOVER_SHARE = 0.6;
const HOLIDAY_WINDOW_DAYS = 2;
const MIN_WEIGHT = 0.1;
const CAPACITY_REPORT_STALE_SECONDS = 30 * 60;
const ZENITH = 90.833;

export type HolidayDateMap = Record<number, Set<string>>;

interface CapacityPair {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

interface HistoricalSample extends CapacityPair {
  crossing: Crossing;
  weight: number;
}

export interface HistoricalEstimate extends CapacityPair {
  fullProbability: number;
  fullRisk: ForecastFullRisk;
  routeClass: ForecastRouteClass;
  sampleSize: number;
  weight: number;
}

interface PeakCalibration {
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

interface DemandProfile {
  daysUntilHoliday: number | null;
  isHolidayDate: boolean;
  isHolidayWindow: boolean;
}

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

// demand profile
const getDemandProfile = (
  slotTime: DateTime,
  holidays: HolidayDateMap
): DemandProfile => ({
  daysUntilHoliday: getDaysUntilHoliday(slotTime, holidays),
  isHolidayDate: isHolidayDate(slotTime, holidays),
  isHolidayWindow: isHolidayWindowDate(slotTime, holidays),
});

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

// historical sample weight
const getSampleWeight = (
  target: DateTime,
  crossing: Crossing,
  terminal: Terminal | null,
  holidays: HolidayDateMap
): number => {
  const crossingTime = DateTime.fromSeconds(crossing.departureTime);
  let weight = getRecencyWeight(target, crossing);
  weight *= getHolidayWeight(target, crossingTime, holidays);
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
  return Math.max(weight, MIN_WEIGHT);
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
  // likely full guard
  if (fullProbability >= 0.5) {
    return "likely";
  }
  // maybe full guard
  if (fullProbability >= 0.2) {
    return "maybe";
  }
  return "low";
};

// route calibration
const getPeakCalibration = (
  samples: NormalizedCapacitySample[],
  profile: DemandProfile,
  targetTotalCapacity: number
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
  const demandPressure = constrain(
    weightedFullShare * 1.4 +
      weightedFullishShare * 0.6 +
      weightedScarceShare * 0.25 +
      weightedBusyShare * 0.1 +
      holidayPressure +
      reservationPressure +
      variancePressure,
    0,
    1
  );
  const fullProbability = round(
    constrain(
      weightedFullShare +
        weightedFullishShare * 0.35 +
        holidayPressure * weightedScarceShare +
        variancePressure,
      0,
      1
    ),
    2
  );
  const weightedQuantile = constrain(0.5 - demandPressure * 0.35, 0.15, 0.5);
  return {
    fullProbability,
    fullRisk: getFullRisk(fullProbability),
    routeClass,
    shouldUsePeakCapacity:
      profile.isHolidayDate ||
      profile.daysUntilHoliday === 1 ||
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
  targetTotalCapacity: number
): CapacityPair & { calibration: PeakCalibration } => {
  const calibration = getPeakCalibration(samples, profile, targetTotalCapacity);
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
    calibration.fullRisk === "likely" &&
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

// historical estimate
export const getHistoricalEstimate = (
  slotTime: DateTime,
  crossings: Crossing[],
  terminal: Terminal | null,
  now: DateTime,
  holidays: HolidayDateMap,
  targetTotalCapacity: number
): HistoricalEstimate | null => {
  const samples: HistoricalSample[] = crossings
    .filter((crossing) =>
      isComparableCrossing(slotTime, crossing, now, holidays)
    )
    .map((crossing) => ({
      crossing,
      driveUpCapacity: crossing.driveUpCapacity,
      reservableCapacity: crossing.reservableCapacity,
      weight: getSampleWeight(slotTime, crossing, terminal, holidays),
    }));

  // sample guard
  if (isEmpty(samples)) {
    return null;
  }

  const normalizedSamples = samples.map((sample) => {
    // normalize boat size
    return normalizeHistoricalSample(sample, targetTotalCapacity);
  });
  const meanCapacity = {
    driveUpCapacity: round(
      weightedMean(
        normalizedSamples.map(({ driveUpCapacity, weight }) => ({
          value: driveUpCapacity,
          weight,
        }))
      )
    ),
    reservableCapacity: round(
      weightedMean(
        normalizedSamples.map(({ reservableCapacity, weight }) => ({
          value: reservableCapacity ?? 0,
          weight,
        }))
      )
    ),
  };
  const demandCapacity = getPeakDemandCapacity(
    normalizedSamples,
    meanCapacity,
    getDemandProfile(slotTime, holidays),
    targetTotalCapacity
  );

  return {
    driveUpCapacity: demandCapacity.driveUpCapacity,
    fullProbability: demandCapacity.calibration.fullProbability,
    fullRisk: demandCapacity.calibration.fullRisk,
    reservableCapacity: demandCapacity.reservableCapacity,
    routeClass: demandCapacity.calibration.routeClass,
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

// uninformative live capacity check
const isUninformativeFullLiveCapacity = (
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime,
  totalCapacity: number
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
  return (
    getAvailableCapacity(crossing) >= totalCapacity &&
    hasStaleCapacityReport(crossing, now)
  );
};

// blend capacities
const blendCapacity = (
  historical: HistoricalEstimate | null,
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime,
  totalCapacity: number
): CapacityPair | null => {
  // stale live guard
  if (
    historical &&
    isUninformativeFullLiveCapacity(crossing, slotTime, now, totalCapacity)
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

// slot weather contract
const getSlotWeather = (
  weather?: WeatherConditions
): SlotWeather | undefined => {
  // missing weather guard
  if (!weather) {
    return undefined;
  }
  return {
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

// exported functions

export const updateEstimates = async (): Promise<void> => {
  const now = DateTime.local();
  await Promise.all(
    values(Schedule.getAll()).map(async (schedule) => {
      // empty schedule guard
      if (isEmpty(schedule.slots)) {
        return;
      }
      const firstTime = schedule.slots[0]?.time;
      const startTime = DateTime.fromSeconds(firstTime)
        .minus({ years: ESTIMATE_COMPOSITE_YEARS })
        .toSeconds();
      const terminal = Terminal.getByIndex(schedule.terminalId);
      const crossings = await Crossing.findAll({
        where: {
          departureId: schedule.terminalId,
          arrivalId: schedule.mateId,
          departureTime: { [Op.gte]: startTime },
        },
      });

      const holidays = await getHolidayDateMap(schedule, crossings);

      const slotTimes = schedule.slots.map((slot) =>
        DateTime.fromSeconds(slot.time)
      );
      const weatherAdjustmentContext = await createWeatherAdjustmentContext({
        now,
        schedule,
        slotTimes,
        terminal,
      });
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

      let rolloverDemand = 0;
      // estimate slots sequentially for cancellation spillover
      for (const [index, slot] of schedule.slots.entries()) {
        const slotTime = slotTimes[index];
        const slotWeather = weatherAdjustmentContext?.forecastsByHour.get(
          slotTime.startOf("hour").toSeconds()
        );
        slot.weather = getSlotWeather(slotWeather);
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
        const liveIsUninformative = isUninformativeFullLiveCapacity(
          slot.crossing,
          slotTime,
          now,
          totalCapacity
        );
        const historical = getHistoricalEstimate(
          slotTime,
          crossings,
          terminal,
          now,
          holidays,
          totalCapacity
        );
        const forecastCrossing =
          historical && liveIsUninformative ? undefined : slot.crossing;
        const disrupted = isDisrupted(slot.crossing);
        const blended = blendCapacity(
          historical,
          forecastCrossing,
          slotTime,
          now,
          totalCapacity
        );
        // capacity already resolved
        const liveDriveCapacity =
          slot.crossing?.driveUpCapacity ?? totalCapacity;
        const liveReservableCapacity =
          slot.crossing?.reservableCapacity ?? totalCapacity;
        // estimate availability guard
        if (!blended) {
          continue;
        }
        let adjusted = blended;
        // future sailing guard
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
        // active rollover guard
        if (rolloverDemand > 0 && !slot.crossing?.isCancelled) {
          rolloverAdjusted = addCancelledRolloverDemand(
            constrained,
            rolloverDemand
          );
          rolloverDemand = 0;
        }
        const estimate: CrossingEstimate = {
          confidence: getConfidence(historical, forecastCrossing, disrupted),
          driveUpCapacity: rolloverAdjusted.driveUpCapacity,
          fullProbability: historical?.fullProbability ?? 0,
          fullRisk: historical?.fullRisk ?? "low",
          reservableCapacity: rolloverAdjusted.reservableCapacity,
          routeClass: historical?.routeClass ?? "standard",
          sampleSize: historical?.sampleSize ?? 0,
          source: getSource(historical, forecastCrossing, disrupted),
        };
        // cancelled sailings are treated as low-confidence live estimates
        if (slot.crossing?.isCancelled) {
          rolloverDemand +=
            getForecastedOccupiedCapacity(constrained, totalCapacity) *
            CANCELLED_CAPACITY_ROLLOVER_SHARE;
          estimate.driveUpCapacity = slot.crossing.driveUpCapacity;
          estimate.reservableCapacity = slot.crossing.reservableCapacity;
        }
        slot.estimate = estimate;
      }
    })
  );
  logger.info("Updated Estimates");
};
