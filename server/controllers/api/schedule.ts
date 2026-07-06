import { Router } from "express";
import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import type {
  Schedule as ScheduleContract,
  Slot,
} from "shared/contracts/schedules";
import type { Vessel } from "shared/contracts/vessels";

import { getErrorMessage, getLogError } from "~/lib/errors";
import { updateEstimates } from "~/lib/forecast";
import { getWsfStatus } from "~/lib/wsf/api";
import { toWsfDate } from "~/lib/wsf/date";
import { updateSchedules } from "~/lib/wsf/updateSchedules";
import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";
import { Vessel as VesselModel } from "~/models/Vessel";

const scheduleRouter = Router();
const schedulePaths = [
  "/:departingId/:arrivingId",
  "/:departingId/:arrivingId/:date",
];
const SCHEDULE_REFRESH_WAIT_MS = 800;
const backgroundScheduleRefreshes = new Map<string, Promise<void>>();

// wait helper
const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

// estimate refresh
const refreshEstimatesInBackground = (scheduleKey: string): void => {
  const schedule = Schedule.getByIndex(scheduleKey);
  // schedule guard
  if (!schedule) {
    return;
  }
  updateEstimates([schedule]).catch((error: unknown) => {
    // background estimate failure
    logger.error(
      `Schedule estimate refresh failed for ${scheduleKey}: ${getErrorMessage(
        error
      )}`,
      getLogError(error)
    );
  });
};

// schedule refresh
const refreshScheduleInBackground = ({
  arrivingId,
  date,
  departingId,
  scheduleKey,
}: {
  arrivingId: string;
  date: string;
  departingId: string;
  scheduleKey: string;
}): Promise<void> => {
  const refreshKey = `${date}:${departingId}:${arrivingId}`;
  const activeRefresh = backgroundScheduleRefreshes.get(refreshKey);
  // single-flight guard
  if (activeRefresh) {
    return activeRefresh;
  }
  const refreshPromise = (async (): Promise<void> => {
    try {
      await updateSchedules(date, departingId, arrivingId);
      refreshEstimatesInBackground(scheduleKey);
    } catch (error: unknown) {
      logger.error(
        `Schedule refresh failed for ${refreshKey}: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    } finally {
      // cleanup in-flight state
      backgroundScheduleRefreshes.delete(refreshKey);
    }
  })();
  backgroundScheduleRefreshes.set(refreshKey, refreshPromise);
  return refreshPromise;
};

// bounded refresh wait
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

// service day bounds
const getHistoricalDayBounds = (date: string): { from: number; to: number } => {
  const serviceDay = DateTime.fromISO(date, {
    zone: "America/Los_Angeles",
  }).set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
  return {
    from: serviceDay.toSeconds(),
    to: serviceDay.plus({ day: 1 }).toSeconds(),
  };
};

// placeholder vessel
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

// historical vessel lookup
const getHistoricalVessel = (crossing: Crossing): Vessel => {
  // stored vessel guard
  if (crossing.vesselId) {
    const vessel = VesselModel.getByIndex(crossing.vesselId);
    // cached vessel guard
    if (vessel) {
      return vessel.serialize();
    }
  }
  return getUnknownHistoricalVessel(crossing.totalCapacity);
};

// historical date check
const isHistoricalDate = (date: string): boolean => {
  const now = DateTime.local().setZone("America/Los_Angeles");
  const requestedServiceDayEnd = DateTime.fromISO(date, {
    zone: "America/Los_Angeles",
  })
    .plus({ days: 1 })
    .set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
  return requestedServiceDayEnd <= now;
};

// crossing fallback
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
  // historical data guard
  if (!crossings.length) {
    return null;
  }
  // historical slots
  const slots: Slot[] = crossings.map((crossing) => ({
    allowsPassengers: true,
    allowsVehicles: true,
    crossing: crossing.toJSON(),
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

scheduleRouter.get(schedulePaths, async (request, response) => {
  const { departingId, arrivingId, date: dateInput } = request.params;
  const date = dateInput || toWsfDate();
  const scheduleKey = Schedule.generateKey(departingId, arrivingId, date);
  const cachedSchedule = Schedule.getByIndex(scheduleKey);
  // cached schedule guard
  if (cachedSchedule) {
    return response.send({
      schedule: cachedSchedule.serialize(),
      timestamp: DateTime.local().toSeconds(),
    });
  }
  // historical fallback guard
  if (isHistoricalDate(date)) {
    const historicalSchedule = await getHistoricalSchedule(
      departingId,
      arrivingId,
      date
    );
    // historical schedule guard
    if (historicalSchedule) {
      return response.send({
        schedule: historicalSchedule,
        timestamp: DateTime.local().toSeconds(),
      });
    }
  } else {
    const refreshPromise = refreshScheduleInBackground({
      arrivingId,
      date,
      departingId,
      scheduleKey,
    });
    const { didRefreshFinish, schedule: refreshedSchedule } =
      await waitForScheduleRefresh(refreshPromise, scheduleKey);
    // refreshed schedule guard
    if (refreshedSchedule) {
      return response.send({
        schedule: refreshedSchedule.serialize(),
        timestamp: DateTime.local().toSeconds(),
      });
    }
    // active refresh guard
    if (!didRefreshFinish) {
      return response.status(503).send({ status: "refreshing" });
    }
  }
  // warming guard
  if (!getWsfStatus().coreReady) {
    return response.status(503).send({ status: "warming" });
  }
  return response.status(404).send();
});

export { scheduleRouter };
