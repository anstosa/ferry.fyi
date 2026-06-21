import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Slot, ValidRange } from "shared/contracts/schedules";
import { isNull } from "shared/lib/identity";
import { values } from "shared/lib/objects";

import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { toWsfDate, wsfDateToTimestamp } from "./date";

// API paths

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const API_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const API_RANGE = `${API_SCHEDULE}/validdaterange`;
const getScheduleApi = (
  departureId: string,
  arrivalId: string,
  date: string = toWsfDate()
): string => `${API_SCHEDULE}/schedule/${date}/${departureId}/${arrivalId}`;

// local state

let lastFlushDate: number | null = null;
const inProgressSchedules = new Map<string, Promise<void>>();

const updateTiming = (): void => {
  const now = DateTime.local();
  values(Schedule.getAll()).forEach((schedule) => {
    const seenVessels: Vessel[] = [];
    schedule.slots.forEach((slot) => {
      const vessel = Vessel.getByIndex(slot.vessel?.id);
      if (!vessel) {
        return;
      }
      if (!seenVessels.includes(vessel)) {
        vessel.update({ departureDelta: 0 });
        vessel.save();
        seenVessels.push(vessel);
      }
      slot.vessel = vessel;
      const { crossing, time } = slot;
      if (crossing) {
        slot.hasPassed = crossing.hasPassed();
      } else {
        slot.hasPassed = DateTime.fromSeconds(time) < now;
      }
    });
  });
};

// "Weekly Unique Identifier"
// Accepts a timestamp from a scheduled sailing
// Generates a key for use in comparing a sailing slot across weeks.
export const getWuid = (departureTime: number): string =>
  DateTime.fromSeconds(departureTime).toFormat("CCC-HH-mm");

// exported functions

export const getPreviousCrossing = (
  departureId: string,
  arrivalId: string,
  departureTime: number
): Crossing | null => {
  const schedule = Schedule.getByIndex(
    Schedule.generateKey(departureId, arrivalId, toWsfDate(departureTime))
  );
  if (!schedule) {
    return null;
  }
  const departureTimes = schedule.slots.map(({ time }) => time).sort();
  const departureIndex = departureTimes.indexOf(departureTime);
  if (departureIndex === 0) {
    return null;
  } else {
    const previousDepartureTime = departureTimes[departureIndex - 1];
    const previousCapacity = schedule?.[previousDepartureTime]?.crossing;
    return previousCapacity ?? null;
  }
};

// get route pairs
const getSchedulePairs = (
  terminalId?: string,
  mateId?: string
): Array<[string, string]> => {
  // explicit pair guard
  if (terminalId && mateId) {
    return [[terminalId, mateId]];
  }
  return values(Terminal.getAll()).reduce(
    (result, terminal) => {
      return result.concat(
        terminal.mates.map((mate) => [terminal.id, mate.id])
      );
    },
    [] as Array<[string, string]>
  );
};

// get valid range
const getValidRange = async (): Promise<ValidRange | null> => {
  const rangeResponse = await wsfRequest<WSF.ValidRangeResponse>(API_RANGE);
  // missing range guard
  if (!rangeResponse) {
    return null;
  }
  return {
    to: wsfDateToTimestamp(rangeResponse.DateThru),
    from: wsfDateToTimestamp(rangeResponse.DateFrom),
  };
};

// update one schedule
const updateSchedulePair = async (
  terminalId: string,
  mateId: string,
  date: string,
  validRange: ValidRange | null
): Promise<void> => {
  const response = await wsfRequest<WSF.ScheduleResponse>(
    getScheduleApi(terminalId, mateId, date)
  );
  // missing response guard
  if (!response) {
    return;
  }
  const {
    TerminalCombos: [{ Times }],
  } = response;
  const seenVessels: Vessel[] = [];

  const slots = await Promise.all(
    Times.map(async ({ DepartingTime, VesselID, LoadingRule }) => {
      const time = wsfDateToTimestamp(DepartingTime);
      // invalid time guard
      if (isNull(time)) {
        return null;
      }
      const departureTime = DateTime.fromSeconds(time);
      const vessel = Vessel.getByIndex(String(VesselID));
      // missing vessel guard
      if (!vessel) {
        return null;
      }
      // first vessel reset
      if (!seenVessels.includes(vessel)) {
        vessel.update({ departureDelta: 0 });
        vessel.save();
        seenVessels.push(vessel);
      }
      const crossing = await Crossing.findOne({
        where: {
          departureId: terminalId,
          arrivalId: mateId,
          departureTime: time,
        },
      });
      return {
        allowsPassengers: [
          WSF.LoadingRules.PASSENGER,
          WSF.LoadingRules.BOTH,
        ].includes(LoadingRule),
        allowsVehicles: [
          WSF.LoadingRules.VEHICLE,
          WSF.LoadingRules.BOTH,
        ].includes(LoadingRule),
        crossing,
        hasPassed: departureTime < DateTime.local(),
        mateId,
        time,
        vessel,
        wuid: getWuid(time),
      };
    })
  );

  const key = Schedule.generateKey(terminalId, mateId, date);
  const data = {
    date,
    key,
    mateId,
    slots: slots.filter(Boolean) as Slot[],
    terminalId,
    validRange,
  };

  const [schedule, wasCreated] = Schedule.getOrCreate(key, data);
  // existing schedule guard
  if (!wasCreated) {
    schedule.update(data);
  }
  schedule.save();
};

export const updateSchedules = async (
  date: string = toWsfDate(),
  terminalId?: string,
  mateId?: string
): Promise<void> => {
  const targetKey = `${date}:${terminalId ?? "*"}:${mateId ?? "*"}`;
  const inProgress = inProgressSchedules.get(targetKey);
  // in-flight guard
  if (inProgress) {
    return inProgress;
  }

  const updatePromise = (async (): Promise<void> => {
    const cacheFlushDate = wsfDateToTimestamp(
      await wsfRequest<string>(API_CACHE)
    );
    const targetScheduleKey = terminalId
      ? Schedule.generateKey(terminalId, mateId ?? "", date)
      : null;
    const hasTargetSchedule = targetScheduleKey
      ? Boolean(Schedule.getByIndex(targetScheduleKey))
      : Schedule.hasFetchedDate(date);
    // fresh cache guard
    if (cacheFlushDate === lastFlushDate && hasTargetSchedule) {
      logger.info(`Skipped Schedule Update for ${targetKey}`);
      return;
    }
    lastFlushDate = cacheFlushDate;
    logger.info(`Started Schedule Update for ${targetKey}`);
    const validRange = await getValidRange();
    const schedulesToUpdate = getSchedulePairs(terminalId, mateId);
    await Promise.all(
      schedulesToUpdate.map(async ([targetTerminalId, targetMateId]) => {
        await updateSchedulePair(
          targetTerminalId,
          targetMateId,
          date,
          validRange
        );
      })
    );
    logger.info(`Updated ${schedulesToUpdate.length} Schedules for ${date}`);
    updateTiming();
  })();

  inProgressSchedules.set(targetKey, updatePromise);
  try {
    await updatePromise;
  } finally {
    inProgressSchedules.delete(targetKey);
  }
};
