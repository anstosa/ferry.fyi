// imports

import { CrossingEstimate, Slot } from "shared/models/schedules";
import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { isNil, isUndefined } from "shared/lib/identity";
import { mean, round } from "shared/lib/math";
import { Op } from "sequelize";
import { setNested } from "shared/lib/objects";
import Crossing from "~/models/Crossing";

const ESTIMATE_COMPOSITE_WEEKS = 6;

// local state
const estimates: {
  [departureId: string]: {
    [arrivalId: string]: {
      [wuid: string]: CrossingEstimate;
    };
  };
} = {};

// exported functions

export const getEstimate = (
  departureId: string,
  arrivalId: string,
  wuid: string
): CrossingEstimate | undefined => estimates[departureId]?.[arrivalId]?.[wuid];

export const buildEstimates = async (
  departureId: string,
  arrivalId: string,
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
  schedule.forEach((crossing) => {
    const { wuid } = crossing;
    const estimate: Record<string, number | null> = {};
    const data: Record<string, any[]> = {
      driveUpCapacity: [],
      reservableCapacity: [],
    };
    for (let index = 0; index < 6; index++) {
      const departureTime = DateTime.fromSeconds(crossing.time)
        .minus({ weeks: index + 1 })
        .toSeconds();
      const slot = findWhere(crossings, { departureTime });
      if (isUndefined(slot)) {
        return;
      }
      const { driveUpCapacity, reservableCapacity } = slot;
      data.driveUpCapacity = data.driveUpCapacity.concat(driveUpCapacity);
      data.reservableCapacity =
        data.reservableCapacity.concat(reservableCapacity);
    }

    estimate.reservableCapacity = round(
      mean(data.reservableCapacity.filter((capacity) => Boolean(capacity)))
    );
    estimate.driveUpCapacity = round(
      mean(data.driveUpCapacity.filter((capacity) => Boolean(capacity))) *
        (previousOffset ?? 1)
    );

    let estimatedTotal: number | null = null;
    if (crossing.crossing && estimate.driveUpCapacity) {
      estimatedTotal =
        crossing.crossing.totalCapacity -
        estimate.driveUpCapacity +
        (estimate.reservableCapacity ?? 0);
    }

    const crossingData = findWhere(crossings, { departureTime: crossing.time });
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
    setNested(estimates, [departureId, arrivalId, wuid], estimate);
  });
};
