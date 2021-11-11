import { constrain, mean, round } from "shared/lib/math";
import { CrossingEstimate } from "shared/contracts/schedules";
import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
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
      // get the earliest sailing time
      const firstTime = schedule.slots[0]?.time;
      // get the the times for the earliest sailing x weeks ago
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
      // track an offset for how wrong the estimates are to adjust future estimates
      let previousOffset: number | null = null;

      schedule.slots.forEach((slot) => {
        // get a list of historical data for this slot
        const data: Record<string, any[]> = {
          driveUpCapacity: [],
          reservableCapacity: [],
        };

        // add data points for each week of history
        for (let index = 0; index < ESTIMATE_COMPOSITE_WEEKS; index++) {
          const departureTime = DateTime.fromSeconds(slot.time)
            .minus({ weeks: index + 1 })
            .toSeconds();
          // get the crossing for the target week
          const crossing = findWhere(crossings, { departureTime });
          if (!crossing) {
            continue;
          }
          // if there is capacity data for this crossing, add it to the list
          const { driveUpCapacity, reservableCapacity } = crossing;
          if (typeof driveUpCapacity === "number") {
            data.driveUpCapacity.push(driveUpCapacity);
          }
          if (typeof reservableCapacity === "number") {
            data.reservableCapacity.push(reservableCapacity);
          }
        }

        // initial estimate based on the mean of the historical data
        // estimate cannot be less than 0 or greater than boat size
        const estimate: CrossingEstimate = {
          reservableCapacity: isEmpty(data.reservableCapacity)
            ? null
            : constrain(
                round(mean(data.reservableCapacity)),
                0,
                slot.crossing?.reservableCapacity || 145
              ),
          driveUpCapacity: isEmpty(data.driveUpCapacity)
            ? 0
            : constrain(
                round(mean(data.driveUpCapacity) / (previousOffset ?? 1)),
                0,
                slot.crossing?.driveUpCapacity || 145
              ),
        };

        let estimatedTotal: number | null = null;
        if (slot.crossing && estimate.driveUpCapacity) {
          estimatedTotal =
            estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0);
        }

        // get actual data to compare against
        const crossingData = findWhere(crossings, {
          departureTime: slot.time,
        });

        let actualTotal: number | null = null;
        if (crossingData) {
          actualTotal =
            crossingData.driveUpCapacity +
            (crossingData.reservableCapacity ?? 0);
        }

        // if our estimate was off by at least 10% of the boat size,
        // update the offset for future estimates
        if (
          !isNull(estimatedTotal) &&
          !isNull(actualTotal) &&
          Math.abs(actualTotal - estimatedTotal) >
            (slot.crossing?.totalCapacity ?? 145) / 10
        ) {
          previousOffset = estimatedTotal / (actualTotal || 1);
        }
        slot.estimate = estimate;
      });
    })
  );
  logger.info("Updated Estimates");
};
