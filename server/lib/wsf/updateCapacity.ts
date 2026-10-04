import { randomUUID } from "node:crypto";

import type { Slot } from "shared/contracts/schedules";
import {
  EARLY_DEPARTURE_TOLERANCE_SECONDS,
  getProjectedTiming,
  isValidDepartureObservation,
} from "shared/lib/projectedTiming";

import {
  CAPACITY_MODEL_INPUT_SCHEMA_VERSION,
  type CapacityObservationInsert,
  type CapacityReportingState,
  insertCapacityObservations,
} from "~/lib/capacityObservations";
import { db } from "~/lib/db";
import logger from "~/lib/logger";
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

interface CapacityReportingStartInput {
  capacityReportingStartedAt?: number | null;
  observedAt: number;
  reportedAvailable: number | null;
  totalCapacity: number;
}

interface CapacitySpaceInput {
  DisplayDriveUpSpace: boolean;
  DisplayReservableSpace: boolean;
  DriveUpSpaceCount?: number;
  ReservableSpaceCount?: number;
}

interface CapacityArrivalWork {
  arrivalId: string;
  directObservation: CapacityObservationInsert;
  schedule: Schedule | null;
  slot: Slot | null;
}

interface CapacityGroupStats {
  createdCrossings: number;
  markedPreviousFull: number;
  missingScheduleLinks: number;
  updatedCrossings: number;
}

// retain a valid nonnegative provider count
const rawCapacityCount = (count?: number): number | null =>
  Number.isFinite(count) && (count as number) >= 0 ? (count as number) : null;

// classify the WSF reporting state at receipt
export const getCapacityReportingState = ({
  capacityReportingStartedAt,
  reportedAvailable,
  spaceData,
}: {
  capacityReportingStartedAt: number | null;
  reportedAvailable: number | null;
  spaceData: CapacitySpaceInput & { MaxSpaceCount: number };
}): CapacityReportingState => {
  // preserve intentionally hidden inventory
  if (!spaceData.DisplayDriveUpSpace) {
    return "hidden";
  }
  // reject a missing displayed drive-up count
  if (rawCapacityCount(spaceData.DriveUpSpaceCount) === null) {
    return "unknown";
  }
  // identify active combined reporting without inferring drive-up maximum
  if (
    capacityReportingStartedAt !== null ||
    (reportedAvailable !== null &&
      Number.isFinite(spaceData.MaxSpaceCount) &&
      reportedAvailable < spaceData.MaxSpaceCount)
  ) {
    return "active";
  }
  return "inactive-all-open";
};

// compute the causal projected departure already visible on a slot
const getProjectedDepartureAtReceipt = (
  schedule: Schedule | null,
  slot: Slot | null,
  departureTime: number
): number => {
  // use the full cached schedule when available
  if (schedule && slot) {
    return Math.floor(
      getProjectedTiming({
        schedule: schedule.slots,
        slot,
      }).departureTime.toSeconds()
    );
  }
  return departureTime;
};

// preserve one slot's causal forecast fields
const buildDirectObservation = ({
  allocationGroupId,
  arrivalId,
  departure,
  departureId,
  departureTime,
  pollId,
  receivedAt,
  reportedAvailable,
  schedule,
  spaceData,
  vesselId,
}: {
  allocationGroupId: string;
  arrivalId: string;
  departure: WSF.SpaceResponse["DepartingSpaces"][number];
  departureId: string;
  departureTime: number;
  pollId: string;
  receivedAt: number;
  reportedAvailable: number | null;
  schedule: Schedule | null;
  spaceData: CapacitySpaceInput & { MaxSpaceCount: number };
  vesselId: string | null;
}): CapacityArrivalWork => {
  const slot = schedule?.getSlot(departureTime) ?? null;
  const reportingStartedAtReceipt = getCapacityReportingStartedAt({
    capacityReportingStartedAt:
      slot?.crossing?.capacityReportingStartedAt ?? null,
    observedAt: receivedAt,
    reportedAvailable,
    totalCapacity: spaceData.MaxSpaceCount,
  });
  const reportingStateAtReceipt = getCapacityReportingState({
    capacityReportingStartedAt: reportingStartedAtReceipt,
    reportedAvailable,
    spaceData,
  });
  const driveUpSpaces = rawCapacityCount(spaceData.DriveUpSpaceCount);
  return {
    arrivalId,
    directObservation: {
      allocationGroupId,
      arrivalId,
      departureEstimateDriveUpSpaces: rawCapacityCount(
        slot?.estimate?.driveUpCapacity
      ),
      departureId,
      departureTime,
      driveUpDisplayed: spaceData.DisplayDriveUpSpace,
      driveUpSpaces,
      forecastFullProbability: Number.isFinite(slot?.estimate?.fullProbability)
        ? (slot?.estimate?.fullProbability as number)
        : null,
      forecastFullRisk: slot?.estimate?.fullRisk ?? null,
      forecastSource: slot?.estimate?.source ?? null,
      isCancelled: departure.IsCancelled,
      maxSpaceCount: rawCapacityCount(spaceData.MaxSpaceCount),
      modelInputSchemaVersion: CAPACITY_MODEL_INPUT_SCHEMA_VERSION,
      pollId,
      projectedDepartureAt: getProjectedDepartureAtReceipt(
        schedule,
        slot,
        departureTime
      ),
      providerReportedAt: null,
      receivedAt,
      repairReason: null,
      reportingStartedAtReceipt,
      reportingStateAtReceipt,
      reservableDisplayed: spaceData.DisplayReservableSpace,
      reservableSpaces: rawCapacityCount(spaceData.ReservableSpaceCount),
      sourceKind: "wsf-direct",
      triggerAllocationGroupId: null,
      triggerPollId: null,
      usableForFillLabel:
        reportingStateAtReceipt === "active" &&
        spaceData.DisplayDriveUpSpace &&
        driveUpSpaces !== null &&
        !departure.IsCancelled,
      vesselId,
    },
    schedule,
    slot,
  };
};

// preserve the synthetic predecessor repair without calling it direct evidence
const buildRepairObservation = ({
  previousCrossing,
  receivedAt,
  triggerAllocationGroupId,
  triggerPollId,
}: {
  previousCrossing: Crossing;
  receivedAt: number;
  triggerAllocationGroupId: string;
  triggerPollId: string;
}): CapacityObservationInsert => ({
  allocationGroupId: null,
  arrivalId: previousCrossing.arrivalId,
  departureEstimateDriveUpSpaces: null,
  departureId: previousCrossing.departureId,
  departureTime: previousCrossing.departureTime,
  driveUpDisplayed: previousCrossing.hasDriveUp,
  driveUpSpaces: 0,
  forecastFullProbability: null,
  forecastFullRisk: null,
  forecastSource: null,
  isCancelled: previousCrossing.isCancelled,
  maxSpaceCount: rawCapacityCount(previousCrossing.totalCapacity),
  modelInputSchemaVersion: CAPACITY_MODEL_INPUT_SCHEMA_VERSION,
  pollId: triggerPollId,
  projectedDepartureAt:
    previousCrossing.departureTime +
    (Number.isFinite(previousCrossing.departureDelta)
      ? (previousCrossing.departureDelta as number)
      : 0),
  providerReportedAt: null,
  receivedAt,
  repairReason: "delayed-predecessor-missing",
  reportingStartedAtReceipt:
    previousCrossing.capacityReportingStartedAt ?? null,
  reportingStateAtReceipt: "unknown",
  reservableDisplayed: previousCrossing.hasReservations,
  reservableSpaces: 0,
  sourceKind: "repair-derived",
  triggerAllocationGroupId,
  triggerPollId,
  usableForFillLabel: false,
  vesselId: previousCrossing.vesselId,
});

// normalize one WSF capacity component
const getReportedCapacityComponent = (
  displayed: boolean,
  count?: number
): number | null => {
  // ignore intentionally hidden components
  if (!displayed) {
    return 0;
  }
  return Number.isFinite(count) ? (count as number) : null;
};

// sum the displayed WSF capacity components
export const getReportedAvailableCapacity = (
  spaceData: CapacitySpaceInput
): number | null => {
  // require at least one displayed capacity component
  if (!spaceData.DisplayDriveUpSpace && !spaceData.DisplayReservableSpace) {
    return null;
  }
  const driveUpCapacity = getReportedCapacityComponent(
    spaceData.DisplayDriveUpSpace,
    spaceData.DriveUpSpaceCount
  );
  const reservableCapacity = getReportedCapacityComponent(
    spaceData.DisplayReservableSpace,
    spaceData.ReservableSpaceCount
  );
  // reject an unexpectedly missing displayed component
  if (driveUpCapacity === null || reservableCapacity === null) {
    return null;
  }
  return driveUpCapacity + reservableCapacity;
};

// preserve the first confirmed capacity movement
export const getCapacityReportingStartedAt = ({
  capacityReportingStartedAt,
  observedAt,
  reportedAvailable,
  totalCapacity,
}: CapacityReportingStartInput): number | null => {
  // preserve established reporting state
  if (Number.isFinite(capacityReportingStartedAt)) {
    return capacityReportingStartedAt as number;
  }
  // require a valid below-max observation
  if (
    totalCapacity > 0 &&
    reportedAvailable !== null &&
    reportedAvailable < totalCapacity
  ) {
    return observedAt;
  }
  return null;
};

// derive delay from one exact vessel departure event
const getCrossingDepartureDelta = (
  vessel: Vessel | null | undefined,
  departureTime: number,
  departureId: string,
  observedAt: number
): number | null => {
  // require a complete matching sailing status
  if (
    !vessel ||
    !isValidDepartureObservation(
      vessel.departedTime,
      departureTime,
      observedAt
    ) ||
    !Number.isFinite(vessel.scheduledDepartureTime) ||
    vessel.scheduledDepartureTime !== departureTime ||
    String(vessel.departingTerminalId) !== departureId
  ) {
    return null;
  }
  return vessel.departedTime - vessel.scheduledDepartureTime;
};

// refresh crossing capacity and vessel assignments
export const updateCapacity = async (): Promise<Schedule[]> => {
  logger.info("Started capacity update");
  const terminals = await wsfRequest<WSF.SpaceResponse[]>(API_SPACE);
  // missing capacity guard
  if (!terminals) {
    logger.info("Skipped capacity update; WSF returned no terminal space data");
    return [];
  }
  const capacityReportUpdatedAt = Math.floor(Date.now() / 1000);
  const pollId = randomUUID();
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
        const allocationGroupId = randomUUID();
        const reportedAvailable = getReportedAvailableCapacity(spaceData);
        const arrivalWork = spaceData.ArrivalTerminalIDs.map((arrivalId) => {
          const arrivalTerminalId = String(arrivalId);
          const schedule = Schedule.getByIndex(
            Schedule.generateKey(
              departureId,
              arrivalTerminalId,
              toWsfDate(departureTime)
            )
          );
          return buildDirectObservation({
            allocationGroupId,
            arrivalId: arrivalTerminalId,
            departure,
            departureId,
            departureTime,
            pollId,
            receivedAt: capacityReportUpdatedAt,
            reportedAvailable,
            schedule,
            spaceData,
            vesselId,
          });
        });
        const transactionResult = await db.transaction(async (transaction) => {
          const stats: CapacityGroupStats = {
            createdCrossings: 0,
            markedPreviousFull: 0,
            missingScheduleLinks: 0,
            updatedCrossings: 0,
          };
          const links: { crossing: Crossing; work: CapacityArrivalWork }[] = [];
          const repairedCrossings: Crossing[] = [];
          await insertCapacityObservations(
            arrivalWork.map(({ directObservation }) => directObservation),
            transaction
          );
          // update each route lookup row inside the physical-group transaction
          for (const work of arrivalWork) {
            const departureDelta = getCrossingDepartureDelta(
              vessel,
              departureTime,
              departureId,
              capacityReportUpdatedAt
            );
            const model: Omit<Partial<Crossing>, "departureDelta"> = {
              arrivalId: work.arrivalId,
              capacityReportingStartedAt:
                work.directObservation.reportingStartedAtReceipt,
              departureId,
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
              arrivalId: work.arrivalId,
              departureId,
              departureTime,
            };
            const [crossing, wasCreated] = await Crossing.findOrCreate({
              defaults: { ...model, departureDelta },
              transaction,
              where,
            });
            // count a new latest-state row
            if (wasCreated) {
              stats.createdCrossings += 1;
            } else {
              // legacy projections cannot confirm a future departure
              const previousDepartureDelta =
                crossing.departureDelta !== null &&
                Number.isFinite(crossing.departureDelta) &&
                crossing.departureDelta >= -EARLY_DEPARTURE_TOLERANCE_SECONDS &&
                departureTime + crossing.departureDelta <=
                  capacityReportUpdatedAt
                  ? crossing.departureDelta
                  : null;
              await crossing.update(
                {
                  ...model,
                  // retain past observations when the vessel moves to another trip
                  departureDelta: departureDelta ?? previousDepartureDelta,
                  capacityReportingStartedAt: getCapacityReportingStartedAt({
                    capacityReportingStartedAt:
                      crossing.capacityReportingStartedAt,
                    observedAt: capacityReportUpdatedAt,
                    reportedAvailable,
                    totalCapacity: spaceData.MaxSpaceCount,
                  }),
                },
                { transaction }
              );
              stats.updatedCrossings += 1;
            }
            links.push({ crossing, work });
            // preserve legacy behavior for unlinked schedules
            if (!work.schedule) {
              stats.missingScheduleLinks += 1;
              continue;
            }
            const previousCrossing = await getPreviousCrossing(
              departureId,
              work.arrivalId,
              departureTime
            );
            // mark only the qualifying missing predecessor state
            if (
              previousCrossing &&
              !previousCrossing.hasPassed() &&
              !previousCrossing.isFull() &&
              !crossing.isEmpty()
            ) {
              await insertCapacityObservations(
                [
                  buildRepairObservation({
                    previousCrossing,
                    receivedAt: capacityReportUpdatedAt,
                    triggerAllocationGroupId: allocationGroupId,
                    triggerPollId: pollId,
                  }),
                ],
                transaction
              );
              await Crossing.update(
                { driveUpCapacity: 0, reservableCapacity: 0 },
                {
                  transaction,
                  where: {
                    arrivalId: previousCrossing.arrivalId,
                    departureId: previousCrossing.departureId,
                    departureTime: previousCrossing.departureTime,
                  },
                }
              );
              repairedCrossings.push(previousCrossing);
              stats.markedPreviousFull += 1;
            }
          }
          return { links, repairedCrossings, stats };
        });
        const {
          links: committedLinks,
          repairedCrossings,
          stats: groupStats,
        } = transactionResult;
        createdCrossings += groupStats.createdCrossings;
        updatedCrossings += groupStats.updatedCrossings;
        missingScheduleLinks += groupStats.missingScheduleLinks;
        markedPreviousFull += groupStats.markedPreviousFull;
        // publish committed repairs to cached crossing instances
        for (const repairedCrossing of repairedCrossings) {
          repairedCrossing.driveUpCapacity = 0;
          repairedCrossing.reservableCapacity = 0;
        }
        // link only committed database state into memory
        for (const { crossing, work } of committedLinks) {
          // skip missing schedules after persistence
          if (!work.schedule) {
            continue;
          }
          affectedSchedules.set(work.schedule.key, work.schedule);
          // link only an existing schedule slot
          if (work.slot) {
            work.slot.crossing = crossing;
            // apply the capacity vessel assignment
            if (vessel) {
              work.slot.vessel = vessel;
            }
            linkedSlots += 1;
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
