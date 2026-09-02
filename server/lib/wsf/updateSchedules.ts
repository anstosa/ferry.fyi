import { DateTime } from "luxon";
import { Slot, ValidRange } from "shared/contracts/schedules";
import { isNull } from "shared/lib/identity";
import { values } from "shared/lib/objects";

import logger from "~/lib/logger";
import {
  formatLogBlock,
  formatRouteLegName,
  formatScheduleTarget,
} from "~/lib/logging";
import Crossing from "~/models/Crossing";
import { Route } from "~/models/Route";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { toWsfDate, wsfDateToTimestamp } from "./date";
import {
  getTidalCancellationsForDate,
  TidalCancellation,
} from "./tidalCancellations";

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

const SCHEDULE_REFRESH_CONCURRENCY = 4;
let lastFlushDate: number | null = null;
const inProgressSchedules = new Map<string, Promise<void>>();

// schedule vessel fallback
const getScheduleVessel = (
  vesselId: number,
  vesselName: string | undefined
): Vessel => {
  const vessel = Vessel.getByIndex(String(vesselId));
  // cached vessel guard
  if (vessel) {
    return vessel;
  }
  return {
    abbreviation: vesselName ?? `Vessel ${vesselId}`,
    id: String(vesselId),
    name: vesselName ?? `Vessel ${vesselId}`,
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: 0,
    vesselWatchUrl: "",
  } as Vessel;
};

// scheduled arrival fallback
const getEstimatedScheduledArrivalTime = (
  departureTime: number,
  terminalId: string,
  mateId: string
): number | undefined => {
  const route = values(Route.getByTerminalId(terminalId)).find((route) => {
    // matching mate guard
    return route.terminalIds.includes(mateId);
  });
  // crossing time guard
  if (!route?.crossingTime) {
    return undefined;
  }
  return departureTime + route.crossingTime * 60;
};

const updateTiming = (): void => {
  const now = DateTime.local();
  values(Schedule.getAll()).forEach((schedule) => {
    schedule.slots.forEach((slot) => {
      // arrival time backfill
      if (!slot.arrivalTime) {
        slot.arrivalTime = getEstimatedScheduledArrivalTime(
          slot.time,
          schedule.terminalId,
          schedule.mateId
        );
      }
      const vessel = Vessel.getByIndex(slot.vessel?.id);
      if (!vessel) {
        return;
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

// cancelled crossing model
const buildCancelledCrossing = (
  cancellation: TidalCancellation,
  totalCapacity: number
): Crossing =>
  Crossing.build({
    arrivalId: cancellation.arrivalId,
    departureDelta: 0,
    departureId: cancellation.departureId,
    departureTime: cancellation.departureTime,
    driveUpCapacity: 0,
    hasDriveUp: false,
    hasReservations: false,
    isCancelled: true,
    reservableCapacity: 0,
    totalCapacity,
  }) as Crossing;

// synthetic vessel fallback
const getCancelledVesselFallback = (cancellation: TidalCancellation): Vessel =>
  ({
    abbreviation: cancellation.vesselName ?? "Cancelled",
    id: cancellation.vesselId ?? "cancelled",
    name: cancellation.vesselName ?? "Cancelled sailing",
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: 0,
    vesselWatchUrl: "",
  }) as Vessel;

// cancellation vessel
const getCancellationVessel = (cancellation: TidalCancellation): Vessel => {
  const vesselById = cancellation.vesselId
    ? Vessel.getByIndex(cancellation.vesselId)
    : null;
  // id match guard
  if (vesselById) {
    return vesselById;
  }
  const vesselByName = values(Vessel.getAll()).find((vessel) => {
    return vessel.name === cancellation.vesselName;
  });
  // name match guard
  if (vesselByName) {
    return vesselByName;
  }
  return getCancelledVesselFallback(cancellation);
};

// merge tidal cancellations
const mergeTidalCancellations = (
  slots: Slot[],
  cancellations: TidalCancellation[],
  terminalId: string,
  mateId: string
): Slot[] => {
  const slotsByTime = new Map(slots.map((slot) => [slot.time, slot]));
  cancellations.forEach((cancellation) => {
    const vessel = getCancellationVessel(cancellation);
    const crossing = buildCancelledCrossing(
      cancellation,
      vessel.vehicleCapacity
    );
    const existingSlot = slotsByTime.get(cancellation.departureTime);
    // existing slot guard
    if (existingSlot) {
      existingSlot.cancellationReason = "tidal";
      existingSlot.crossing = crossing;
      existingSlot.vessel = vessel;
      return;
    }
    const time = DateTime.fromSeconds(cancellation.departureTime);
    slotsByTime.set(cancellation.departureTime, {
      allowsPassengers: true,
      allowsVehicles: true,
      arrivalTime: getEstimatedScheduledArrivalTime(
        cancellation.departureTime,
        terminalId,
        mateId
      ),
      cancellationReason: "tidal",
      crossing,
      hasPassed: time < DateTime.local(),
      mateId,
      time: cancellation.departureTime,
      vessel,
      vesselPosition: cancellation.vesselPosition,
      wuid: getWuid(cancellation.departureTime),
    });
  });
  return Array.from(slotsByTime.values()).sort((left, right) => {
    return left.time - right.time;
  });
};

// best-effort tidal lookup
const getBestEffortTidalCancellations = async (
  date: string,
  terminalId: string,
  mateId: string
): Promise<TidalCancellation[]> => {
  // tidal best-effort
  try {
    return await getTidalCancellationsForDate(date, terminalId, mateId);
  } catch (error: any) {
    logger.error(`Tidal cancellation update failed: ${error.message}`, error);
    return [];
  }
};

// refresh cached tidal slots
const refreshCachedTidalCancellations = async (
  date: string,
  terminalId?: string,
  mateId?: string
): Promise<void> => {
  const targetSchedule = terminalId
    ? Schedule.getByIndex(Schedule.generateKey(terminalId, mateId ?? "", date))
    : null;
  const schedules = targetSchedule
    ? [targetSchedule]
    : values(Schedule.getByDate(date));
  await Promise.all(
    schedules.map(async (schedule) => {
      const cancellations = await getBestEffortTidalCancellations(
        date,
        schedule.terminalId,
        schedule.mateId
      );
      // cancellation guard
      if (!cancellations.length) {
        return;
      }
      schedule.update({
        slots: mergeTidalCancellations(
          schedule.slots,
          cancellations,
          schedule.terminalId,
          schedule.mateId
        ),
      });
      schedule.save();
    })
  );
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
  const departureTimes = schedule.slots
    .map(({ time }) => time)
    .sort((left, right) => left - right);
  const departureIndex = departureTimes.indexOf(departureTime);
  // missing previous slot guard
  if (departureIndex <= 0) {
    return null;
  }
  const previousDepartureTime = departureTimes[departureIndex - 1];
  return schedule.getSlot(previousDepartureTime)?.crossing ?? null;
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
): Promise<number> => {
  const response = await wsfRequest<WSF.ScheduleResponse>(
    getScheduleApi(terminalId, mateId, date)
  );
  // missing response guard
  if (!response) {
    return 0;
  }
  const {
    TerminalCombos: [{ Times }],
  } = response;
  const slots = await Promise.all(
    Times.map(
      async ({
        ArrivingTime,
        DepartingTime,
        VesselID,
        VesselName,
        LoadingRule,
        VesselPositionNum,
      }) => {
        const time = wsfDateToTimestamp(DepartingTime);
        // invalid time guard
        if (isNull(time)) {
          return null;
        }
        const departureTime = DateTime.fromSeconds(time);
        const vessel = getScheduleVessel(VesselID, VesselName);
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
          arrivalTime: ArrivingTime
            ? wsfDateToTimestamp(ArrivingTime)
            : getEstimatedScheduledArrivalTime(time, terminalId, mateId),
          allowsVehicles: [
            WSF.LoadingRules.VEHICLE,
            WSF.LoadingRules.BOTH,
          ].includes(LoadingRule),
          crossing,
          hasPassed: departureTime < DateTime.local(),
          mateId,
          time,
          vessel,
          vesselPosition: VesselPositionNum,
          wuid: getWuid(time),
        };
      }
    )
  );

  const cancellations = await getBestEffortTidalCancellations(
    date,
    terminalId,
    mateId
  );
  const mergedSlots = mergeTidalCancellations(
    slots.filter(Boolean) as Slot[],
    cancellations,
    terminalId,
    mateId
  );
  const key = Schedule.generateKey(terminalId, mateId, date);
  const data = {
    date,
    forecastSourceUpdatedAt: null,
    key,
    mateId,
    slots: mergedSlots,
    sourceUpdatedAt: DateTime.local().toSeconds(),
    terminalId,
    validRange,
  };

  const [schedule, wasCreated] = Schedule.getOrCreate(key, data);
  // existing schedule guard
  if (!wasCreated) {
    schedule.update(data);
  }
  schedule.save();
  return mergedSlots.length;
};

// update schedule pairs with bounded concurrency
const updateSchedulePairs = async (
  schedulesToUpdate: Array<[string, string]>,
  date: string,
  validRange: ValidRange | null
): Promise<number[]> => {
  const slotCounts: number[] = [];
  let nextPairIndex = 0;
  const workerCount = Math.min(
    SCHEDULE_REFRESH_CONCURRENCY,
    schedulesToUpdate.length
  );
  // bounded worker pool
  const workers = Array.from({ length: workerCount }, async () => {
    // schedule pair queue
    while (nextPairIndex < schedulesToUpdate.length) {
      const pairIndex = nextPairIndex;
      nextPairIndex += 1;
      const [targetTerminalId, targetMateId] = schedulesToUpdate[pairIndex];
      const slotCount = await updateSchedulePair(
        targetTerminalId,
        targetMateId,
        date,
        validRange
      );
      logger.info(
        `Updated schedule pair ${formatRouteLegName(
          targetTerminalId,
          targetMateId
        )} for ${date}: ${slotCount} sailings`
      );
      slotCounts[pairIndex] = slotCount;
    }
  });
  await Promise.all(workers);
  return slotCounts;
};

export const updateSchedules = async (
  date: string = toWsfDate(),
  terminalId?: string,
  mateId?: string
): Promise<void> => {
  const targetKey = `${date}:${terminalId ?? "*"}:${mateId ?? "*"}`;
  const targetLabel = formatScheduleTarget(date, terminalId, mateId);
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
      logger.info(
        `Skipped schedule update for ${targetLabel}; cache flush unchanged`
      );
      await refreshCachedTidalCancellations(date, terminalId, mateId);
      updateTiming();
      return;
    }
    lastFlushDate = cacheFlushDate;
    logger.info(
      `Started schedule update for ${targetLabel}; cache flush ${
        cacheFlushDate ?? "unknown"
      }`
    );
    const validRange = await getValidRange();
    const schedulesToUpdate = getSchedulePairs(terminalId, mateId);
    const slotCounts = await updateSchedulePairs(
      schedulesToUpdate,
      date,
      validRange
    );
    const totalSlots = slotCounts.reduce((total, slotCount) => {
      // total sailings
      return total + slotCount;
    }, 0);
    logger.info(
      formatLogBlock("Schedule update complete", [
        {
          heading: "target",
          lines: [targetLabel],
        },
        {
          heading: "summary",
          lines: [
            `schedule pairs: ${schedulesToUpdate.length}`,
            `total sailings: ${totalSlots}`,
          ],
        },
      ])
    );
    updateTiming();
  })();

  inProgressSchedules.set(targetKey, updatePromise);
  try {
    await updatePromise;
  } finally {
    inProgressSchedules.delete(targetKey);
  }
};
