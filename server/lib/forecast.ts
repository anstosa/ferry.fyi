// imports

import {
  concat,
  each,
  filter,
  find,
  isEmpty,
  isNil,
  isUndefined,
  mean,
  mergeWith,
  round,
  setWith,
  times,
} from "lodash";
import { CrossingEstimate, Slot } from "shared/models/schedules";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import Crossing from "~/models/crossing";

const ESTIMATE_COMPOSITE_WEEKS = 6;

// local state
const estimates: {
  [departureId: number]: {
    [arrivalId: number]: {
      [wuid: string]: CrossingEstimate;
    };
  };
} = {};

// exported functions

export const getEstimate = (
  departureId: number,
  arrivalId: number,
  wuid: string
): CrossingEstimate | undefined => estimates[departureId]?.[arrivalId]?.[wuid];

export const buildEstimates = async (
  departureId: number,
  arrivalId: number,
  schedule?: Slot[]
): Promise<void> => {
  if (isUndefined(schedule) || isEmpty(schedule)) {
    return;
  }
  const firstTime = schedule[0]?.time;
  const startTime = DateTime.fromSeconds(firstTime)
    .minus({ weeks: ESTIMATE_COMPOSITE_WEEKS })
    .toSeconds();
  const crossings = await Crossing.findAll({
    where: {
      departureId,
      arrivalId,
      departureTime: { [Op.gte]: startTime },
    },
  });
  let previousOffset: number | null = null;
  each(schedule, (crossing) => {
    const { wuid } = crossing;
    const estimate: Record<string, number | null> = {};
    const data: Record<string, any[]> = {
      driveUpCapacity: [],
      reservableCapacity: [],
    };
    times(ESTIMATE_COMPOSITE_WEEKS, (index) => {
      const departureTime = DateTime.fromSeconds(crossing.time)
        .minus({ weeks: index + 1 })
        .toSeconds();
      const slot = find(crossings, { departureTime });
      if (isUndefined(slot)) {
        return;
      }
      const { driveUpCapacity, reservableCapacity } = slot;
      const dataPoint: CrossingEstimate = {
        driveUpCapacity,
        reservableCapacity,
      };
      mergeWith(data, dataPoint, (array, value) => concat(array, value));
    });

    estimate.reservableCapacity = round(mean(filter(data.reservableCapacity)));
    estimate.driveUpCapacity =
      round(mean(filter(data.driveUpCapacity))) * (previousOffset ?? 1);

    let estimatedTotal: number | null = null;
    if (crossing.crossing && estimate.driveUpCapacity) {
      estimatedTotal =
        crossing.crossing.totalCapacity -
        estimate.driveUpCapacity +
        (estimate.reservableCapacity ?? 0);
    }

    const crossingData = find(crossings, { departureTime: crossing.time });
    let actualTotal: number | null = null;
    if (crossingData) {
      actualTotal =
        crossingData.totalCapacity -
        crossingData.driveUpCapacity +
        (estimate.reservableCapacity ?? 0);
    }
    if (!isNil(estimatedTotal) && !isNil(actualTotal)) {
      previousOffset = estimatedTotal / actualTotal;
    }
    setWith(estimates, [departureId, arrivalId, wuid], estimate, Object);
  });
};
