/**
 * Library for WSF APIs:
 * * https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html
 *
 * We wrap these APIs in order to orchestrate caching, proxy XML into a useful
 * format, and filter/rename the fields
 */

// imports

import { buildEstimates, getEstimate } from "./forecast";
import { Crossing as CrossingType, Slot } from "shared/models/schedules";
import { DateTime } from "luxon";
import {
  each,
  filter,
  has,
  includes,
  indexOf,
  isNull,
  keyBy,
  keys,
  map,
  round,
  setWith,
  sortBy,
  toNumber,
} from "lodash";
import { getToday, wsfDateToTimestamp } from "./date";
import { getVessel } from "./vessels";
import { Op } from "sequelize";
import { Route } from "shared/models/terminals";
import { wsfRequest } from "./api";
import Crossing from "~/models/crossing";
import logger from "heroku-logger";
import sync from "aigle";

// types

enum LoadingRules {
  Passenger = 1,
  Vehicle = 2,
  Both = 3,
}

enum Seasons {
  Spring = 0,
  Summer = 1,
  Fall = 2,
  Winter = 3,
}

interface TerminalScheduleTimeResponse {
  DepartingTime: string;
  ArrivingTime: string | null;
  LoadingRule: LoadingRules;
  VesselID: number;
  VesselName: string;
  VesselHandicapAccessible: boolean;
  Routes: number[];
  AnnotationIndexes: number[];
}
interface TerminalScheduleResponse {
  DepartingTerminalID: number;
  DepartingTerminalName: string;
  ArrivingTerminalID: number;
  ArrivingTerminalName: string;
  SailingNotes: string;
  Annotations: string[];
  AnnotationsIVR: string[];
  Times: TerminalScheduleTimeResponse[];
}

interface ScheduleTodayResponse {
  ScheduleID: number;
  ScheduleName: string;
  ScheduleSeason: Seasons;
  SchedulePDFUrl: string;
  ScheduleStart: string;
  ScheduleEnd: string;
  AllRoutes: number[];
  TerminalCombos: TerminalScheduleResponse[];
}

interface MatesResponse {
  DepartingTerminalID: number;
  DepartingDescription: string;
  ArrivingTerminalID: number;
  ArrivingDescription: string;
}

interface AlertResponse {
  BulletinID: number;
  BulletinFlag: boolean;
  CommunicationFlag: boolean;
  PublishDate?: string;
  AlertDescription?: string;
  DisruptionDescription?: string;
  AlertFullTitle: string;
  AlertFullText: string;
  IVRText?: string;
}
interface RouteResponse {
  RouteID: number;
  RouteAbbrev: string;
  Description: string;
  RegionID: number;
  VesselWatchID: number;
  ReservationFlag: boolean;
  InternationalFlag: boolean;
  PassengerOnlyFlag: boolean;
  CrossingTime?: string;
  AdaNotes?: string;
  GeneralRouteNotes?: string;
  SeasonalRouteNotes?: string;
  Alerts: AlertResponse[];
}

interface ServerSlot extends Slot {
  crossing?: Crossing;
}

// API paths

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const API_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const apiMatesRoute = (): string =>
  `${API_SCHEDULE}/terminalsandmates/${getToday()}`;
const apiRoute = (departingId: number, arrivingId: number): string =>
  `${API_SCHEDULE}/routedetails/${getToday()}/${departingId}/${arrivingId}`;
const apiToday = (departingId: number, arrivingId: number): string =>
  `${API_SCHEDULE}/scheduletoday/${departingId}/${arrivingId}/false`;

// local state

let lastFlushDate: number | null = null;
interface SchedulesByTerminal {
  [departureId: number]: {
    [arrivalId: number]: {
      [departureTime: number]: ServerSlot;
    };
  };
}
const scheduleByTerminal: SchedulesByTerminal = {};
const matesByTerminalId: Record<number, number[]> = {};

// local functions

const addMate = (id: number, mateId: number): void => {
  if (has(matesByTerminalId, id)) {
    matesByTerminalId[id].push(mateId);
  } else {
    matesByTerminalId[id] = [mateId];
  }
};

const backfillCrossings = async (): Promise<void> => {
  const yesterday = round(DateTime.local().minus({ days: 1 }).toSeconds());
  const crossings = await Crossing.findAll({
    where: { departureTime: { [Op.gt]: yesterday } },
  });
  each(crossings, (crossing) => {
    const { departureId, arrivalId, departureTime } = crossing;
    const slot =
      scheduleByTerminal?.[departureId]?.[arrivalId]?.[departureTime];
    if (slot) {
      slot.crossing = crossing;
    }
  });
};

const updateTiming = (): void => {
  const now = DateTime.local();
  sync.each(scheduleByTerminal, (mates) =>
    sync.each(mates, (schedule) => {
      const seenVessels: number[] = [];
      sync.each(schedule, (slot) => {
        const vesselId = slot.vessel?.id;
        if (!vesselId) {
          return;
        }
        const isFirstOfVessel = !includes(seenVessels, vesselId);
        const vessel = getVessel(vesselId, isFirstOfVessel);
        if (isFirstOfVessel) {
          seenVessels.push(vesselId);
        }
        slot.vessel = vessel;
        const { crossing, time } = slot;
        if (crossing) {
          slot.hasPassed = hasPassed(crossing);
        } else {
          slot.hasPassed = DateTime.fromSeconds(time) < now;
        }
      });
    })
  );
};

// "Weekly Unique Identifier"
// Accepts a timestamp from a scheduled sailing
// Generates a key for use in comparing a sailing slot across weeks.
export const getWuid = (departureTime: number): string =>
  DateTime.fromSeconds(departureTime).toFormat("CCC-HH-mm");

// exported functions

export const hasPassed = (crossing: CrossingType): boolean => {
  if (!crossing) {
    return false;
  }
  const { departureTime, departureDelta } = crossing;
  let estimatedTime = DateTime.fromSeconds(departureTime);
  if (departureDelta) {
    estimatedTime = estimatedTime.plus({
      seconds: departureDelta,
    });
  }
  const now = DateTime.local();
  const hasPassed = estimatedTime < now;
  return hasPassed;
};

export const getPreviousCrossing = (
  departureId: number,
  arrivalId: number,
  departureTime: number
): Crossing | null => {
  const schedule = scheduleByTerminal?.[departureId]?.[arrivalId];
  const departureTimes = sortBy(keys(schedule) as unknown as number[]);
  const departureIndex = indexOf(departureTimes, departureTime);
  if (departureIndex === 0) {
    return null;
  } else {
    const previousDepartureTime = departureTimes[departureIndex - 1];
    const previousCapacity = schedule?.[previousDepartureTime]?.crossing;
    return previousCapacity ?? null;
  }
};

export const isCrossingEmpty = (crossing: CrossingType): boolean => {
  const { driveUpCapacity, reservableCapacity, totalCapacity } = crossing;
  return driveUpCapacity + reservableCapacity === totalCapacity;
};

export const isCrossingFull = (crossing: CrossingType): boolean => {
  const { driveUpCapacity, reservableCapacity } = crossing;
  return driveUpCapacity === 0 && reservableCapacity === 0;
};

export const getMates = (): Record<number, number[]> => matesByTerminalId;

export const getSchedules = (): SchedulesByTerminal => scheduleByTerminal;

export const getSchedule = (
  departingId: number,
  arrivingId: number
): Slot[] => {
  const schedule = scheduleByTerminal?.[departingId]?.[arrivingId];
  return sortBy(map(schedule), "time");
};

export const updateSchedule = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped Schedule API Update");
    return;
  }
  lastFlushDate = cacheFlushDate;
  logger.info("Started Mates Update");
  const mates = await wsfRequest<MatesResponse[]>(apiMatesRoute());
  each(keys(matesByTerminalId), (key) => {
    delete matesByTerminalId[toNumber(key)];
  });
  each(mates, ({ DepartingTerminalID, ArrivingTerminalID }) =>
    addMate(DepartingTerminalID, ArrivingTerminalID)
  );
  logger.info("Completed Mates Update");
  logger.info("Started Schedule Update");
  await sync.eachSeries(matesByTerminalId, (mates, terminalId) =>
    sync.eachSeries(mates, async (mateId) => {
      const response = await wsfRequest<ScheduleTodayResponse>(
        apiToday(toNumber(terminalId), mateId)
      );
      if (!response) {
        return;
      }
      const {
        TerminalCombos: [{ Times }],
      } = response;
      const seenVessels: number[] = [];

      const schedule = filter(
        map(Times, ({ DepartingTime, VesselID, LoadingRule }) => {
          const time = wsfDateToTimestamp(DepartingTime);
          if (isNull(time)) {
            return null;
          }
          const departureTime = DateTime.fromSeconds(time);
          const isFirstOfVessel = !includes(seenVessels, VesselID);
          const vessel = getVessel(VesselID, isFirstOfVessel);
          if (isFirstOfVessel) {
            seenVessels.push(VesselID);
          }
          return {
            allowsPassengers: includes(
              [LoadingRules.Passenger, LoadingRules.Both],
              LoadingRule
            ),
            allowsVehicles: includes(
              [LoadingRules.Vehicle, LoadingRules.Both],
              LoadingRule
            ),
            hasPassed: departureTime < DateTime.local(),
            wuid: getWuid(time),
            time,
            vessel,
          };
        })
      ) as Slot[];

      setWith(
        scheduleByTerminal,
        [terminalId, mateId],
        keyBy(schedule, "time"),
        Object
      );
      await buildEstimates(toNumber(terminalId), mateId, schedule);
    })
  );
  logger.info("Completed Schedule Update");
  logger.info("Completed Schedule API Update");
  await backfillCrossings();
  updateTiming();
  updateEstimates();
};

export const getRoute = async (
  terminalId: number,
  mateId: number
): Promise<Route | undefined> => {
  const route = await wsfRequest<RouteResponse>(apiRoute(terminalId, mateId));
  if (!route) {
    return;
  }
  return {
    id: route.RouteID,
    abbreviation: route.RouteAbbrev,
    description: route.Description,
    crossingTime: toNumber(route.CrossingTime),
  };
};

export const updateEstimates = (): void => {
  each(scheduleByTerminal, (mates, departureId) =>
    each(mates, (schedule, mateId) =>
      each(schedule, (slot) => {
        const estimate = getEstimate(
          toNumber(departureId),
          toNumber(mateId),
          getWuid(slot.time)
        );
        if (!estimate) {
          return;
        }
        slot.estimate = estimate;
      })
    )
  );
  logger.info("Updated Estimates");
};
