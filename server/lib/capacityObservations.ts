import { Op, type Transaction } from "sequelize";

import { db } from "~/lib/db";
import type {
  CapacityReportingState,
  FillTimingObservation,
} from "~/lib/fillTiming";
import CapacityObservation, {
  type CapacityObservationRepairReason,
  type CapacityObservationSourceKind,
} from "~/models/CapacityObservation";

export const CAPACITY_OBSERVATION_RETENTION_DAYS = 400;
export const CAPACITY_OBSERVATION_RETENTION_SECONDS =
  CAPACITY_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60;
export const CAPACITY_OBSERVATION_RETENTION_BATCH_SIZE = 2_000;
// budget fourfold headroom over observed one-minute ingestion
export const CAPACITY_OBSERVATION_RETENTION_MAX_BATCHES = 500;
export const CAPACITY_MODEL_INPUT_SCHEMA_VERSION = "capacity-input-v1";

export interface CapacityObservationRecord extends FillTimingObservation {
  arrivalId: string;
  departureEstimateDriveUpSpaces: number | null;
  departureId: string;
  forecastFullProbability: number | null;
  forecastFullRisk: string | null;
  forecastSource: string | null;
  isCancelled: boolean;
  maxSpaceCount: number | null;
  modelInputSchemaVersion: string;
  pollId: string;
  projectedDepartureAt: number | null;
  providerReportedAt: number | null;
  repairReason: CapacityObservationRepairReason | null;
  reportingStartedAtReceipt: number | null;
  reservableDisplayed: boolean;
  reservableSpaces: number | null;
  sourceKind: CapacityObservationSourceKind;
  triggerAllocationGroupId: string | null;
  triggerPollId: string | null;
}

export type CapacityObservationInsert = CapacityObservationRecord;

export interface ReadCapacityObservationsInput {
  arrivalId: string;
  asOf: number;
  departureId: string;
  departureTimes: number[];
}

export interface CapacityObservationRetentionResult {
  cutoff: number;
  deleted: number;
  exhaustedBatchBudget: boolean;
}

// coerce a postgres bigint to a safe epoch number
const epochNumber = (value: number | string | null): number | null => {
  // preserve database nulls
  if (value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
};

// normalize one immutable database row
const normalizeObservation = (
  row: CapacityObservation
): CapacityObservationRecord | null => {
  const departureTime = epochNumber(row.departureTime);
  const receivedAt = epochNumber(row.receivedAt);
  // reject unsafe epoch values
  if (departureTime === null || receivedAt === null) {
    return null;
  }
  return {
    allocationGroupId: row.allocationGroupId,
    arrivalId: row.arrivalId,
    departureEstimateDriveUpSpaces: row.departureEstimateDriveUpSpaces,
    departureId: row.departureId,
    departureTime,
    driveUpDisplayed: row.driveUpDisplayed,
    driveUpSpaces: row.driveUpSpaces,
    forecastFullProbability: row.forecastFullProbability,
    forecastFullRisk: row.forecastFullRisk,
    forecastSource: row.forecastSource,
    isCancelled: row.isCancelled,
    maxSpaceCount: row.maxSpaceCount,
    modelInputSchemaVersion: row.modelInputSchemaVersion,
    pollId: row.pollId,
    projectedDepartureAt: epochNumber(row.projectedDepartureAt),
    providerReportedAt: epochNumber(row.providerReportedAt),
    receivedAt,
    repairReason: row.repairReason,
    reportingStartedAtReceipt: epochNumber(row.reportingStartedAtReceipt),
    reportingStateAtReceipt: row.reportingStateAtReceipt,
    reservableDisplayed: row.reservableDisplayed,
    reservableSpaces: row.reservableSpaces,
    sourceKind: row.sourceKind,
    triggerAllocationGroupId: row.triggerAllocationGroupId,
    triggerPollId: row.triggerPollId,
    usableForFillLabel: row.usableForFillLabel,
    vesselId: row.vesselId,
  };
};

// append observations without mutating prior evidence
export const insertCapacityObservations = async (
  rows: CapacityObservationInsert[],
  transaction?: Transaction
): Promise<void> => {
  // skip empty provider groups
  if (!rows.length) {
    return;
  }
  const insertRows = rows.map((row) => ({ ...row })) as unknown as Parameters<
    typeof CapacityObservation.bulkCreate
  >[0];
  await CapacityObservation.bulkCreate(insertRows, {
    ignoreDuplicates: true,
    ...(transaction ? { transaction } : {}),
  });
};

// read one causal sailing snapshot
export const readCapacityObservations = async ({
  arrivalId,
  asOf,
  departureId,
  departureTimes,
}: ReadCapacityObservationsInput): Promise<CapacityObservationRecord[]> => {
  // reject empty or invalid queries
  if (
    !departureTimes.length ||
    !Number.isFinite(asOf) ||
    departureTimes.some((departureTime) => !Number.isFinite(departureTime))
  ) {
    return [];
  }
  const rows = await CapacityObservation.findAll({
    order: [
      ["departureTime", "ASC"],
      ["receivedAt", "ASC"],
      ["id", "ASC"],
    ],
    where: {
      arrivalId,
      departureId,
      departureTime: { [Op.in]: departureTimes },
      receivedAt: { [Op.lte]: asOf },
    },
  });
  return rows
    .map(normalizeObservation)
    .filter(
      (observation): observation is CapacityObservationRecord =>
        observation !== null
    );
};

// purge only evidence beyond the declared retention window
export const purgeCapacityObservations = async ({
  asOf = Math.floor(Date.now() / 1_000),
  batchSize = CAPACITY_OBSERVATION_RETENTION_BATCH_SIZE,
  maxBatches = CAPACITY_OBSERVATION_RETENTION_MAX_BATCHES,
}: {
  asOf?: number;
  batchSize?: number;
  maxBatches?: number;
} = {}): Promise<CapacityObservationRetentionResult> => {
  const cutoff = asOf - CAPACITY_OBSERVATION_RETENTION_SECONDS;
  let deleted = 0;
  let exhaustedBatchBudget = false;
  // process bounded batches
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deletedInBatch = await db.transaction(async (transaction) => {
      const rows = await CapacityObservation.findAll({
        attributes: ["id"],
        limit: batchSize,
        lock: transaction.LOCK.UPDATE,
        order: [["receivedAt", "ASC"]],
        skipLocked: true,
        transaction,
        where: { receivedAt: { [Op.lt]: cutoff } },
      });
      // finish when no expired rows remain
      if (!rows.length) {
        return 0;
      }
      return CapacityObservation.destroy({
        transaction,
        where: { id: { [Op.in]: rows.map(({ id }) => id) } },
      });
    });
    deleted += deletedInBatch;
    // stop after the final short batch
    if (deletedInBatch < batchSize) {
      return { cutoff, deleted, exhaustedBatchBudget: false };
    }
    exhaustedBatchBudget = batch === maxBatches - 1;
  }
  return { cutoff, deleted, exhaustedBatchBudget };
};

export type { CapacityReportingState };
