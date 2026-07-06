import logger from "heroku-logger";

import { formatLogBlock } from "~/lib/logging";
import Crossing from "~/models/Crossing";
import { Schedule } from "~/models/Schedule";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { toWsfDate, wsfDateToTimestamp } from "./date";
import { getPreviousCrossing } from "./updateSchedules";
import { API_TERMINALS } from "./updateTerminals";

const API_SPACE = `${API_TERMINALS}/terminalsailingspace`;

export const updateCapacity = async (): Promise<Schedule[]> => {
  logger.info("Started capacity update");
  const terminals = await wsfRequest<WSF.SpaceResponse[]>(API_SPACE);
  // missing capacity guard
  if (!terminals) {
    logger.info("Skipped capacity update; WSF returned no terminal space data");
    return [];
  }
  const capacityReportUpdatedAt = Math.floor(Date.now() / 1000);
  const affectedSchedules = new Map<string, Schedule>();
  let createdCrossings = 0;
  let updatedCrossings = 0;
  let linkedSlots = 0;
  let missingScheduleLinks = 0;
  let markedPreviousFull = 0;
  // terminal space records
  for (const terminal of terminals) {
    const departureId = String(terminal.TerminalID);
    // departure space records
    for (const departure of terminal.DepartingSpaces) {
      const vessel = Vessel.getByIndex(String(departure.VesselID));
      const vesselId = departure.VesselID ? String(departure.VesselID) : null;
      const departureTime = wsfDateToTimestamp(departure.Departure);
      // arrival space groups
      for (const spaceData of departure.SpaceForArrivalTerminals) {
        // arrival terminals
        for (const arrivalId of spaceData.ArrivalTerminalIDs) {
          const arrivalTerminalId = String(arrivalId);
          const model: Partial<Crossing> = {
            arrivalId: arrivalTerminalId,
            departureId,
            departureDelta: vessel?.departureDelta ?? null,
            departureTime,
            capacityReportUpdatedAt,
            driveUpCapacity: spaceData.DriveUpSpaceCount,
            hasDriveUp: spaceData.DisplayDriveUpSpace,
            hasReservations: spaceData.DisplayReservableSpace,
            isCancelled: departure.IsCancelled,
            reservableCapacity: spaceData.ReservableSpaceCount,
            totalCapacity: spaceData.MaxSpaceCount,
            vesselId,
            vesselName: vessel?.name ?? null,
          };
          const where = {
            arrivalId: arrivalTerminalId,
            departureId,
            departureTime,
          };
          const [crossing, wasCreated] = await Crossing.findOrCreate({
            where,
            defaults: model,
          });
          // created crossing guard
          if (wasCreated) {
            createdCrossings += 1;
          } else {
            await crossing.update(model);
            updatedCrossings += 1;
          }
          const schedule = Schedule.getByIndex(
            Schedule.generateKey(
              departureId,
              arrivalTerminalId,
              toWsfDate(departureTime)
            )
          );
          // missing schedule guard
          if (!schedule) {
            missingScheduleLinks += 1;
            continue;
          }
          affectedSchedules.set(schedule.key, schedule);

          const slot = schedule.getSlot(departureTime);
          // schedule slot guard
          if (slot) {
            slot.crossing = crossing;
            linkedSlots += 1;
          }

          // Because of how WSF reports data, if the previous run is running so
          // behind, it's scheduled to leave after the next run was scheduled,
          // they'll stop reporting real-time data against it. So if the next run not
          // empty, report the previous run as full.
          const previousCrossing = await getPreviousCrossing(
            departureId,
            arrivalTerminalId,
            departureTime
          );
          if (
            previousCrossing &&
            !previousCrossing.hasPassed() &&
            !previousCrossing.isFull() &&
            !crossing.isEmpty()
          ) {
            await previousCrossing.update({
              driveUpCapacity: 0,
              reservableCapacity: 0,
            });
            markedPreviousFull += 1;
          }
        }
      }
    }
  }
  logger.info(
    formatLogBlock("Capacity update complete", [
      {
        heading: "summary",
        lines: [`terminals: ${terminals.length}`],
      },
      {
        heading: "crossings",
        lines: [
          `created: ${createdCrossings}`,
          `updated: ${updatedCrossings}`,
          `linked to schedule slots: ${linkedSlots}`,
          `delayed previous sailings marked full: ${markedPreviousFull}`,
          `missing schedule links: ${missingScheduleLinks}`,
        ],
      },
    ])
  );
  return Array.from(affectedSchedules.values());
};
