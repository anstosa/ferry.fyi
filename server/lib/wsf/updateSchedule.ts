import { buildEstimates, getEstimate } from "../forecast";
import { DateTime } from "luxon";
import { entries, setNested, values } from "shared/lib/objects";
import { getToday } from "./date";
import { isNull } from "shared/lib/identity";
import { keyBy, sortBy } from "shared/lib/arrays";
import { Op } from "sequelize";
import { round } from "shared/lib/math";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import { wsfRequest } from "./api";
import Crossing from "~/models/Crossing";
import logger from "heroku-logger";

interface ServerSlot extends Slot {
  crossing?: Crossing;
}

// API paths

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const API_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const getScheduleApi = (routeId: string, date: string = getToday()): string =>
  `${API_SCHEDULE}/schedule/${date}/${routeId}`;

// local state

let lastFlushDate: number | null = null;
interface SchedulesByTerminal {
  [departureId: string]: {
    [arrivalId: string]: {
      [departureTime: number]: ServerSlot;
    };
  };
}

const backfillCrossings = async (): Promise<void> => {
  const yesterday = round(DateTime.local().minus({ days: 1 }).toSeconds());
  const crossings = await Crossing.findAll({
    where: { departureTime: { [Op.gt]: yesterday } },
  });
  crossings.forEach((crossing) => {
    const { departureId, arrivalId, departureTime } = crossing;
    const slot =
      scheduleByTerminal?.[departureId]?.[arrivalId]?.[departureTime];
    if (slot) {
      slot.crossing = crossing;
    } else {
      console.log(
        `No Matching slot for crossing ${departureId}-${arrivalId}-${departureTime}`
      );
    }
  });
};

const updateTiming = (): void => {
  const now = DateTime.local();
  entries(scheduleByTerminal).forEach(([, mates]) => {
    entries(mates).forEach(([, schedule]) => {
      const seenVessels: Vessel[] = [];
      entries(schedule).forEach(([, slot]) => {
        const vesselId = slot.vessel?.id;
        if (!vesselId) {
          return;
        }
        const vessel = Vessel.getByIndex(vesselId);
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
  const schedule = scheduleByTerminal?.[departureId]?.[arrivalId];
  const departureTimes = Object.keys(schedule).sort();
  const departureIndex = departureTimes.indexOf(String(departureTime));
  if (departureIndex === 0) {
    return null;
  } else {
    const previousDepartureTime = Number(departureTimes[departureIndex - 1]);
    const previousCapacity = schedule?.[previousDepartureTime]?.crossing;
    return previousCapacity ?? null;
  }
};

export const getSchedules = (): SchedulesByTerminal => scheduleByTerminal;

export const getSchedule = (
  departingId: string,
  arrivingId: string
): Slot[] => {
  const schedule = scheduleByTerminal?.[departingId]?.[arrivingId];
  return sortBy(
    entries(schedule).map(([, slot]) => slot),
    "time"
  );
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
      const response = await wsfRequest<ScheduleTodayResponse>(
        getScheduleApi(terminalId, mateId)
      );
      if (!response) {
        return;
      }
      const {
        TerminalCombos: [{ Times }],
      } = response;
      const seenVessels: Vessel[] = [];

      const schedule = Times.map(({ DepartingTime, VesselID, LoadingRule }) => {
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
        return {
          mateId,
          allowsPassengers: [
            LoadingRules.PASSENGER,
            LoadingRules.BOTH,
          ].includes(LoadingRule),
          allowsVehicles: [LoadingRules.VEHICLE, LoadingRules.BOTH].includes(
            LoadingRule
          ),
          hasPassed: departureTime < DateTime.local(),
          wuid: getWuid(time),
          time,
          vessel,
        };
      }).filter((slot) => Boolean(slot)) as Slot[];

      const [camera, wasCreated] = Camera.getOrCreate(
        String(FerryCamera.CamID),
        data
      );
      if (!wasCreated) {
        camera.update(data);
      }
      camera.save();

      setNested(
        scheduleByTerminal,
        [terminalId, mateId],
        keyBy(schedule, "time")
      );
      await buildEstimates(terminalId, mateId, schedule);
    })
  );
  // purge non-updated routes
  const schedules = values(Schedule.getAll());
  schedules.forEach((schedule) => {
    if (!updatedSchedules?.includes(schedule)) {
      schedule.purge();
    }
  });
  logger.info("Completed Schedule Update");
  await backfillCrossings();
  updateTiming();
  updateEstimates();
};

export const updateEstimates = (): void => {
  entries(scheduleByTerminal).forEach(([departureId, mates]) =>
    entries(mates).forEach(([mateId, schedule]) =>
      entries(schedule).forEach(([, slot]) => {
        const estimate = getEstimate(departureId, mateId, getWuid(slot.time));
        if (!estimate) {
          return;
        }
        slot.estimate = estimate;
      })
    )
  );
  logger.info("Updated Estimates");
};
