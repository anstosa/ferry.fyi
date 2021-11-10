import { DateTime } from "luxon";
import { isNull } from "shared/lib/identity";
import { Schedule } from "~/models/Schedule";
import { Slot } from "shared/contracts/schedules";
import { Terminal } from "~/models/Terminal";
import { toWsfDate, wsfDateToTimestamp } from "./date";
import { values } from "shared/lib/objects";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";
import { wsfRequest } from "./api";
import Crossing from "~/models/Crossing";
import logger from "heroku-logger";

// API paths

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const API_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const getScheduleApi = (
  departureId: string,
  arrivalId: string,
  date: string = toWsfDate()
): string => `${API_SCHEDULE}/schedule/${date}/${departureId}/${arrivalId}`;

// local state

let lastFlushDate: number | null = null;

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

export const updateSchedule = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped Schedule Update");
    return;
  }
  lastFlushDate = cacheFlushDate;
  logger.info("Started Schedule Update");
  // get all combinations of [departureId, arrivalId]
  const schedulesToUpdate = values(Terminal.getAll()).reduce(
    (result, terminal) => {
      return result.concat(
        terminal.mates.map((mate) => [terminal.id, mate.id])
      );
    },
    [] as Array<[string, string]>
  );
  const updatedSchedules = await Promise.all(
    schedulesToUpdate.map(async ([terminalId, mateId]) => {
      const response = await wsfRequest<WSF.ScheduleTodayResponse>(
        getScheduleApi(terminalId, mateId)
      );
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
          if (isNull(time)) {
            return null;
          }
          const departureTime = DateTime.fromSeconds(time);
          const vessel = Vessel.getByIndex(String(VesselID));
          if (!vessel) {
            return null;
          }
          if (!seenVessels.includes(vessel)) {
            vessel.update({ departureDelta: 0 });
            vessel.save();
            seenVessels.push(vessel);
          }
          const crossing = await Crossing.findOne({
            where: { departureTime: time },
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

      const date = toWsfDate();
      const key = Schedule.generateKey(terminalId, mateId, date);

      const data = {
        date,
        key,
        mateId,
        slots: slots.filter(Boolean) as Slot[],
        terminalId,
      };

      const [schedule, wasCreated] = Schedule.getOrCreate(key, data);
      if (!wasCreated) {
        schedule.update(data);
      }
      schedule.save();
      return schedule;
    })
  );
  // purge non-updated routes
  const schedules = values(Schedule.getAll());
  schedules.forEach((schedule) => {
    if (!updatedSchedules?.includes(schedule)) {
      schedule.purge();
    }
  });
  logger.info(`Updated ${Object.keys(Schedule.getAll()).length} Schedules`);
  updateTiming();
};
