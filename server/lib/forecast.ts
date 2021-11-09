import { CrossingEstimate } from "shared/models/schedules";
import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { isNil } from "shared/lib/identity";
import { mean, round } from "shared/lib/math";
import { Op } from "sequelize";
import { Schedule } from "~/models/Schedule";
import { values } from "shared/lib/objects";
import Crossing from "~/models/Crossing";
import logger from "heroku-logger";

const ESTIMATE_COMPOSITE_WEEKS = 6;

// exported functions

export const updateEstimates = async (): Promise<void> => {
  await Promise.all(
    values(Schedule.getAll()).map(async (schedule) => {
      if (isEmpty(schedule.slots)) {
        return;
      }
      const firstTime = schedule.slots[0]?.time;
      const startTime = DateTime.fromSeconds(firstTime)
        .minus({ weeks: ESTIMATE_COMPOSITE_WEEKS })
        .toSeconds();
      const crossings = await Crossing.findAll({
        where: {
          departureId: schedule.terminalId,
          arrivalId: schedule.mateId,
          departureTime: { [Op.gte]: startTime },
        },
      });
      let previousOffset: number | null = null;
      schedule.slots.forEach((slot) => {
        const data: Record<string, any[]> = {
          driveUpCapacity: [],
          reservableCapacity: [],
        };

        for (let index = 0; index < ESTIMATE_COMPOSITE_WEEKS; index++) {
          const departureTime = DateTime.fromSeconds(slot.time)
            .minus({ weeks: index + 1 })
            .toSeconds();
          const crossing = findWhere(crossings, { departureTime });
          if (!crossing) {
            continue;
          }
          const { driveUpCapacity, reservableCapacity } = crossing;
          data.driveUpCapacity.push(driveUpCapacity);
          data.reservableCapacity.push(reservableCapacity);
        }

        const estimate: CrossingEstimate = {
          reservableCapacity: round(
            mean(data.reservableCapacity.filter(Boolean))
          ),
          driveUpCapacity: round(
            mean(data.driveUpCapacity.filter(Boolean)) * (previousOffset ?? 1)
          ),
        };

        let estimatedTotal: number | null = null;
        if (slot.crossing && estimate.driveUpCapacity) {
          estimatedTotal =
            slot.crossing.totalCapacity -
            estimate.driveUpCapacity +
            (estimate.reservableCapacity ?? 0);
        }

        const crossingData = findWhere(crossings, {
          departureTime: slot.time,
        });
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
        slot.estimate = estimate;
      });
    })
  );
  logger.info("Updated Estimates");
};
