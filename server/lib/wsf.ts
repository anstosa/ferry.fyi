import { getCapacity, updateTerminals } from "./terminals";
import {
  getPreviousCrossing,
  getSchedule,
  hasPassed,
  isCrossingEmpty,
  isCrossingFull,
  updateEstimates,
  updateSchedule,
} from "./schedule";
import { getVessel, updateVessels, updateVesselStatus } from "./vessels";
import { wsfDateToTimestamp } from "./date";
import Crossing from "~/models/crossing";
import logger from "heroku-logger";
import sync from "aigle";

const updateCapacity = async (): Promise<void> => {
  logger.info("Started Capacity Update");
  const terminals = await getCapacity();
  if (!terminals) {
    return;
  }
  await sync.each(terminals, async (terminal) => {
    await sync.each(terminal.DepartingSpaces, async (departure) => {
      await sync.each(departure.SpaceForArrivalTerminals, async (spaceData) => {
        const vessel = getVessel(departure.VesselID);
        const departureTime = wsfDateToTimestamp(departure.Departure);
        await sync.each(spaceData.ArrivalTerminalIDs, async (arrivalId) => {
          const model: Partial<Crossing> = {
            arrivalId,
            departureId: terminal.TerminalID,
            departureDelta: vessel?.departureDelta ?? null,
            departureTime,
            driveUpCapacity: spaceData.DriveUpSpaceCount,
            hasDriveUp: spaceData.DisplayDriveUpSpace,
            hasReservations: spaceData.DisplayReservableSpace,
            isCancelled: departure.IsCancelled,
            reservableCapacity: spaceData.ReservableSpaceCount,
            totalCapacity: spaceData.MaxSpaceCount,
          };
          const where = {
            arrivalId,
            departureId: terminal.TerminalID,
            departureTime,
          };
          const [crossing, wasCreated] = await Crossing.findOrCreate({
            where,
            defaults: model,
          });
          if (!wasCreated) {
            await crossing.update(model);
          }
          const slot = getSchedule(terminal.TerminalID, arrivalId)[
            departureTime
          ];

          if (slot) {
            slot.crossing = crossing;
          }

          // Because of how WSF reports data, if the previous run is running so
          // behind, it's scheduled to leave after the next run was scheduled,
          // they'll stop reporting real-time data against it. So if the next run not
          // empty, report the previous run as full.
          const previousCrossing = await getPreviousCrossing(
            terminal.TerminalID,
            arrivalId,
            departureTime
          );
          if (
            previousCrossing &&
            !hasPassed(previousCrossing) &&
            !isCrossingFull(previousCrossing) &&
            !isCrossingEmpty(crossing)
          ) {
            await previousCrossing.update({
              driveUpCapacity: 0,
              reservableCapacity: 0,
            });
          }
        });
      });
    });
  });
  logger.info("Completed Capacity Update");
};

export const updateLong = async (): Promise<any> => {
  await updateVessels();
  // schedule relies on vessels
  await updateSchedule();
  // terminals relies on schedule
  await updateTerminals();
};

export const updateShort = async (): Promise<void> => {
  await updateVesselStatus();
  await updateCapacity();
  updateEstimates();
};
