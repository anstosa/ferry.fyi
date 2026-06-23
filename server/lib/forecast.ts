import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import {
  CrossingEstimate,
  ForecastConfidence,
} from "shared/contracts/schedules";
import { isEmpty } from "shared/lib/arrays";
import { constrain, round } from "shared/lib/math";
import { values } from "shared/lib/objects";

import { getWashingtonHolidayDates } from "~/lib/holidays";
import {
  createWeatherAdjustmentContext,
  getWeatherAdjustedCapacity,
} from "~/lib/weather/capacityAdjustment";
import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const ESTIMATE_COMPOSITE_WEEKS = 60;
const DELAY_DISRUPTION_SECONDS = 15 * 60;
const DEFAULT_CAPACITY = 145;
const MIN_WEIGHT = 0.1;
const ZENITH = 90.833;

type HolidayDateMap = Record<number, Set<string>>;

interface CapacityPair {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

interface HistoricalSample extends CapacityPair {
  crossing: Crossing;
  weight: number;
}

interface HistoricalEstimate extends CapacityPair {
  sampleSize: number;
  weight: number;
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
  // holiday target mismatch
  if (targetIsHoliday) {
    return 0.25;
  }
  // historical holiday mismatch
  if (crossingIsHoliday) {
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

// historical estimate
const getHistoricalEstimate = (
  slotTime: DateTime,
  crossings: Crossing[],
  terminal: Terminal | null,
  now: DateTime,
  holidays: HolidayDateMap
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

  return {
    driveUpCapacity: round(
      weightedMean(
        samples.map(({ driveUpCapacity, weight }) => ({
          value: driveUpCapacity,
          weight,
        }))
      )
    ),
    reservableCapacity: round(
      weightedMean(
        samples.map(({ reservableCapacity, weight }) => ({
          value: reservableCapacity ?? 0,
          weight,
        }))
      )
    ),
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

// blend capacities
const blendCapacity = (
  historical: HistoricalEstimate | null,
  crossing: Crossing | undefined,
  slotTime: DateTime,
  now: DateTime
): CapacityPair | null => {
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
        .minus({ weeks: ESTIMATE_COMPOSITE_WEEKS })
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

      // estimate slots
      await Promise.all(
        schedule.slots.map(async (slot, index) => {
          const slotTime = slotTimes[index];
          const historical = getHistoricalEstimate(
            slotTime,
            crossings,
            terminal,
            now,
            holidays
          );
          const disrupted = isDisrupted(slot.crossing);
          const blended = blendCapacity(
            historical,
            slot.crossing,
            slotTime,
            now
          );
          const totalCapacity =
            slot.crossing?.totalCapacity ?? DEFAULT_CAPACITY;
          const liveDriveCapacity =
            slot.crossing?.driveUpCapacity ?? totalCapacity;
          const liveReservableCapacity =
            slot.crossing?.reservableCapacity ?? totalCapacity;
          // estimate availability guard
          if (!blended) {
            return;
          }
          const adjusted = await getWeatherAdjustedCapacity({
            capacity: blended,
            context: weatherAdjustmentContext,
            liveCapacity: {
              driveUpCapacity: liveDriveCapacity,
              reservableCapacity: liveReservableCapacity,
            },
            slotTime,
            terminal,
          });
          const estimate: CrossingEstimate = {
            confidence: getConfidence(historical, slot.crossing, disrupted),
            driveUpCapacity: constrain(
              adjusted.driveUpCapacity,
              0,
              liveDriveCapacity
            ),
            reservableCapacity: constrain(
              adjusted.reservableCapacity ?? 0,
              0,
              liveReservableCapacity
            ),
            sampleSize: historical?.sampleSize ?? 0,
            source: getSource(historical, slot.crossing, disrupted),
          };
          // cancelled sailings are treated as low-confidence live estimates
          if (slot.crossing?.isCancelled) {
            estimate.driveUpCapacity = slot.crossing.driveUpCapacity;
            estimate.reservableCapacity = slot.crossing.reservableCapacity;
          }
          slot.estimate = estimate;
        })
      );
    })
  );
  logger.info("Updated Estimates");
};
