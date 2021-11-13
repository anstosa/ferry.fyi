import { API_TERMINALS } from "./updateTerminals";
import { getPreviousCrossing } from "./updateSchedules";
import { Schedule } from "~/models/Schedule";
import { toWsfDate, wsfDateToTimestamp } from "./date";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";
import { wsfRequest } from "./api";
import Crossing from "~/models/Crossing";
import logger from "heroku-logger";

const API_SPACE = `${API_TERMINALS}/terminalsailingspace`;

export const updateCapacity = async (): Promise<void> => {
  logger.info("Started Capacity Update");
  const terminals = await wsfRequest<WSF.SpaceResponse[]>(API_SPACE);
  if (!terminals) {
    return;
  }
  await Promise.all([
    terminals.map(async (terminal) => {
      await Promise.all([
        terminal.DepartingSpaces.map(async (departure) => {
          await Promise.all([
            departure.SpaceForArrivalTerminals.map(async (spaceData) => {
              const vessel = Vessel.getByIndex(String(departure.VesselID));
              const departureTime = wsfDateToTimestamp(departure.Departure);
              await Promise.all([
                spaceData.ArrivalTerminalIDs.map(async (ArrivalID) => {
                  const model: Partial<Crossing> = {
                    arrivalId: String(ArrivalID),
                    departureId: String(terminal.TerminalID),
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
                    arrivalId: String(ArrivalID),
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
                  const schedule = Schedule.getByIndex(
                    Schedule.generateKey(
                      String(terminal.TerminalID),
                      String(ArrivalID),
                      toWsfDate(departureTime)
                    )
                  );

                  if (!schedule) {
                    return;
                  }

                  const slot = schedule.getSlot(departureTime);

                  if (slot) {
                    slot.crossing = crossing;
                  }

                  // Because of how WSF reports data, if the previous run is running so
                  // behind, it's scheduled to leave after the next run was scheduled,
                  // they'll stop reporting real-time data against it. So if the next run not
                  // empty, report the previous run as full.
                  const previousCrossing = await getPreviousCrossing(
                    String(terminal.TerminalID),
                    String(ArrivalID),
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
                  }
                }),
              ]);
            }),
          ]);
        }),
      ]);
    }),
  ]);
  logger.info("Completed Capacity Update");
};
