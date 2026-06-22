import { Router } from "express";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import type {
  Schedule as ScheduleContract,
  Slot,
} from "shared/contracts/schedules";
import type { Vessel } from "shared/contracts/vessels";

import { updateEstimates } from "~/lib/forecast";
import { getWsfStatus } from "~/lib/wsf/api";
import { toWsfDate } from "~/lib/wsf/date";
import { updateSchedules } from "~/lib/wsf/updateSchedules";
import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";

const scheduleRouter = Router();
const schedulePaths = [
  "/:departingId/:arrivingId",
  "/:departingId/:arrivingId/:date",
];

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
const getHistoricalVessel = (totalCapacity: number): Vessel =>
  ({
    abbreviation: "Hist",
    id: "historical",
    name: "Historical sailing",
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: totalCapacity,
    vesselWatchUrl: "",
  }) as Vessel;

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
    vessel: getHistoricalVessel(crossing.totalCapacity),
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
  const historicalSchedule = isHistoricalDate(date)
    ? await getHistoricalSchedule(departingId, arrivingId, date)
    : null;
  const hasFetchedDate = Schedule.hasFetchedDate(date);
  let cachedSchedule = await Schedule.getByIndex(scheduleKey);
  // requested pair guard
  if (!historicalSchedule && (!hasFetchedDate || !cachedSchedule)) {
    await updateSchedules(date, departingId, arrivingId);
    await updateEstimates();
    cachedSchedule = await Schedule.getByIndex(scheduleKey);
  }
  const schedule = cachedSchedule?.serialize() ?? historicalSchedule;
  // schedule found guard
  if (schedule) {
    return response.send({
      schedule,
      timestamp: DateTime.local().toSeconds(),
    });
  }
  // warming guard
  if (!getWsfStatus().coreReady) {
    return response.status(503).send({ status: "warming" });
  }
  return response.status(404).send();
});

export { scheduleRouter };
