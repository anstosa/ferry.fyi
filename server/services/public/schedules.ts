import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import type {
  Crossing as CrossingContract,
  Schedule as ScheduleContract,
  Slot,
} from "shared/contracts/schedules";
import type { Vessel } from "shared/contracts/vessels";

import { getErrorMessage, getLogError } from "~/lib/errors";
import { getWsfStatus } from "~/lib/wsf/api";
import { updateSchedules } from "~/lib/wsf/updateSchedules";
import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";
import { Vessel as VesselModel } from "~/models/Vessel";

const SCHEDULE_REFRESH_WAIT_MS = 800;
const backgroundScheduleRefreshes = new Map<string, Promise<void>>();

export type PublicScheduleResult =
  | { schedule: ScheduleContract; status: "available"; timestamp: number }
  | { status: "not-found" | "refreshing" | "warming" };

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const timestamp = (): number => DateTime.local().toSeconds();

// refresh one missing live schedule without forecast recomputation
const refreshScheduleInBackground = ({
  arrivingId,
  date,
  departingId,
}: {
  arrivingId: string;
  date: string;
  departingId: string;
}): Promise<void> => {
  const refreshKey = `${date}:${departingId}:${arrivingId}`;
  const activeRefresh = backgroundScheduleRefreshes.get(refreshKey);
  if (activeRefresh) {
    return activeRefresh;
  }
  const refreshPromise = (async (): Promise<void> => {
    try {
      // defer CPU-heavy forecasts to the bounded scheduled refresh
      await updateSchedules(date, departingId, arrivingId);
    } catch (error: unknown) {
      logger.error(
        `Schedule refresh failed for ${refreshKey}: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    } finally {
      backgroundScheduleRefreshes.delete(refreshKey);
    }
  })();
  backgroundScheduleRefreshes.set(refreshKey, refreshPromise);
  return refreshPromise;
};

const waitForScheduleRefresh = async (
  refreshPromise: Promise<void>,
  scheduleKey: string
): Promise<{ didRefreshFinish: boolean; schedule: Schedule | null }> => {
  const didRefreshFinish = await Promise.race([
    refreshPromise.then(() => true),
    wait(SCHEDULE_REFRESH_WAIT_MS).then(() => false),
  ]);
  return {
    didRefreshFinish,
    schedule: Schedule.getByIndex(scheduleKey) ?? null,
  };
};

const getHistoricalDayBounds = (date: string): { from: number; to: number } => {
  const serviceDay = DateTime.fromISO(date, {
    zone: "America/Los_Angeles",
  }).set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
  return {
    from: serviceDay.toSeconds(),
    to: serviceDay.plus({ day: 1 }).toSeconds(),
  };
};

const getUnknownHistoricalVessel = (totalCapacity: number): Vessel =>
  ({
    abbreviation: "Unknown",
    id: "historical",
    name: "Unknown vessel",
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: totalCapacity,
    vesselWatchUrl: "",
  }) as Vessel;

const getHistoricalVessel = (crossing: Crossing): Vessel => {
  if (crossing.vesselId) {
    const vessel = VesselModel.getByIndex(crossing.vesselId);
    if (vessel) {
      return vessel.serialize();
    }
  }
  return getUnknownHistoricalVessel(crossing.totalCapacity);
};

const serializePublicCrossing = (crossing: Crossing): CrossingContract => ({
  arrivalId: crossing.arrivalId,
  capacityReportUpdatedAt: crossing.capacityReportUpdatedAt,
  departureDelta: crossing.departureDelta,
  departureId: crossing.departureId,
  departureTime: crossing.departureTime,
  driveUpCapacity: crossing.driveUpCapacity,
  hasDriveUp: crossing.hasDriveUp,
  hasReservations: crossing.hasReservations,
  isCancelled: crossing.isCancelled,
  reservableCapacity: crossing.reservableCapacity,
  totalCapacity: crossing.totalCapacity,
  vesselId: crossing.vesselId,
  vesselName: crossing.vesselName,
});

const isHistoricalDate = (date: string): boolean => {
  const now = DateTime.local().setZone("America/Los_Angeles");
  const requestedServiceDayEnd = DateTime.fromISO(date, {
    zone: "America/Los_Angeles",
  })
    .plus({ days: 1 })
    .set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
  return requestedServiceDayEnd <= now;
};

const getHistoricalSchedule = async (
  departingId: string,
  arrivingId: string,
  date: string
): Promise<ScheduleContract | null> => {
  const { from, to } = getHistoricalDayBounds(date);
  const crossings = await Crossing.findAll({
    order: [["departureTime", "ASC"]],
    where: {
      arrivalId: arrivingId,
      departureId: departingId,
      departureTime: {
        [Op.gte]: from,
        [Op.lt]: to,
      },
    },
  });
  if (!crossings.length) {
    return null;
  }
  const slots: Slot[] = crossings.map((crossing) => ({
    allowsPassengers: true,
    allowsVehicles: true,
    crossing: serializePublicCrossing(crossing),
    hasPassed: true,
    mateId: arrivingId,
    time: crossing.departureTime,
    vessel: getHistoricalVessel(crossing),
    wuid: DateTime.fromSeconds(crossing.departureTime).toFormat("CCC-HH-mm"),
  }));
  return {
    date,
    key: Schedule.generateKey(departingId, arrivingId, date),
    mateId: arrivingId,
    slots,
    terminalId: departingId,
    validRange: null,
  };
};

export const getCachedPublicSchedule = ({
  arrivingId,
  date,
  departingId,
}: {
  arrivingId: string;
  date: string;
  departingId: string;
}): PublicScheduleResult => {
  const schedule = Schedule.getByIndex(
    Schedule.generateKey(departingId, arrivingId, date)
  );
  if (schedule) {
    return {
      schedule: schedule.serialize(),
      status: "available",
      timestamp: timestamp(),
    };
  }
  return { status: "not-found" };
};

/**
 * Reads the in-memory schedule cache or persisted historical crossings for
 * SSR without starting provider work. Browser hydration may use
 * getPublicSchedule to refresh a current miss, but document requests stay
 * side-effect free so crawler traffic cannot fan out into WSDOT refreshes.
 */
export const getPublicSsrSchedule = async (input: {
  arrivingId: string;
  date: string;
  departingId: string;
}): Promise<PublicScheduleResult> => {
  const cachedResult = getCachedPublicSchedule(input);
  if (cachedResult.status === "available") {
    return cachedResult;
  }
  if (isHistoricalDate(input.date)) {
    const historicalSchedule = await getHistoricalSchedule(
      input.departingId,
      input.arrivingId,
      input.date
    );
    if (historicalSchedule) {
      return {
        schedule: historicalSchedule,
        status: "available",
        timestamp: timestamp(),
      };
    }
    return getWsfStatus().coreReady
      ? { status: "not-found" }
      : { status: "warming" };
  }
  const refreshKey = `${input.date}:${input.departingId}:${input.arrivingId}`;
  return backgroundScheduleRefreshes.has(refreshKey)
    ? { status: "refreshing" }
    : { status: "warming" };
};

export const getPublicSchedule = async ({
  arrivingId,
  date,
  departingId,
}: {
  arrivingId: string;
  date: string;
  departingId: string;
}): Promise<PublicScheduleResult> => {
  const cachedResult = getCachedPublicSchedule({
    arrivingId,
    date,
    departingId,
  });
  if (cachedResult.status === "available") {
    return cachedResult;
  }

  const scheduleKey = Schedule.generateKey(departingId, arrivingId, date);
  if (isHistoricalDate(date)) {
    const historicalSchedule = await getHistoricalSchedule(
      departingId,
      arrivingId,
      date
    );
    if (historicalSchedule) {
      return {
        schedule: historicalSchedule,
        status: "available",
        timestamp: timestamp(),
      };
    }
  } else {
    const refreshPromise = refreshScheduleInBackground({
      arrivingId,
      date,
      departingId,
    });
    const { didRefreshFinish, schedule } = await waitForScheduleRefresh(
      refreshPromise,
      scheduleKey
    );
    if (schedule) {
      return {
        schedule: schedule.serialize(),
        status: "available",
        timestamp: timestamp(),
      };
    }
    if (!didRefreshFinish) {
      return { status: "refreshing" };
    }
  }
  return getWsfStatus().coreReady
    ? { status: "not-found" }
    : { status: "warming" };
};
