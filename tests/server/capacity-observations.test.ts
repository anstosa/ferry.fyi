import { Op } from "sequelize";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observationModel = vi.hoisted(() => ({
  bulkCreate: vi.fn(),
  destroy: vi.fn(),
  findAll: vi.fn(),
}));
const database = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("~/lib/db", () => ({ db: database }));
vi.mock("~/models/CapacityObservation", () => ({
  default: observationModel,
}));

const {
  CAPACITY_OBSERVATION_RETENTION_BATCH_SIZE,
  CAPACITY_OBSERVATION_RETENTION_MAX_BATCHES,
  CAPACITY_OBSERVATION_RETENTION_SECONDS,
  insertCapacityObservations,
  purgeCapacityObservations,
  readCapacityObservations,
} = await import("../../server/lib/capacityObservations");

const OBSERVED_AT = 2_000_000_000;

// build one complete immutable row
const row = () => ({
  allocationGroupId: "00000000-0000-4000-8000-000000000001",
  arrivalId: "14",
  departureEstimateDriveUpSpaces: 5,
  departureId: "5",
  departureTime: OBSERVED_AT + 3_600,
  driveUpDisplayed: true,
  driveUpSpaces: 20,
  forecastFullProbability: 0.2,
  forecastFullRisk: "low",
  forecastSource: "live",
  isCancelled: false,
  maxSpaceCount: 120,
  modelInputSchemaVersion: "capacity-input-v1",
  pollId: "00000000-0000-4000-8000-000000000002",
  projectedDepartureAt: OBSERVED_AT + 3_660,
  providerReportedAt: null,
  receivedAt: OBSERVED_AT,
  repairReason: null,
  reportingStartedAtReceipt: OBSERVED_AT - 60,
  reportingStateAtReceipt: "active" as const,
  reservableDisplayed: false,
  reservableSpaces: null,
  sourceKind: "wsf-direct" as const,
  triggerAllocationGroupId: null,
  triggerPollId: null,
  usableForFillLabel: true,
  vesselId: "15",
});

describe("capacity observation persistence", () => {
  // keep the daily budget ahead of observed ingestion with fourfold headroom
  it("can retire more daily observations than the collectors add", () => {
    const observedRowsPerMinute = 150;
    const minutesPerDay = 24 * 60;
    expect(
      CAPACITY_OBSERVATION_RETENTION_BATCH_SIZE *
        CAPACITY_OBSERVATION_RETENTION_MAX_BATCHES
    ).toBeGreaterThanOrEqual(4 * observedRowsPerMinute * minutesPerDay);
  });

  // reset persistence doubles
  beforeEach(() => {
    vi.clearAllMocks();
    database.transaction.mockImplementation((callback) =>
      callback({ LOCK: { UPDATE: "UPDATE" } })
    );
  });

  // append with retry-only deduplication
  it("uses insert-only bulk persistence with duplicate suppression", async () => {
    const transaction = { id: "transaction" } as never;

    await insertCapacityObservations([row()], transaction);

    expect(observationModel.bulkCreate).toHaveBeenCalledWith([row()], {
      ignoreDuplicates: true,
      transaction,
    });
  });

  // read only the requested causal snapshot
  it("returns normalized flat observations for selected sailings", async () => {
    observationModel.findAll.mockResolvedValue([
      { ...row(), departureTime: String(OBSERVED_AT + 3_600) },
    ]);

    const result = await readCapacityObservations({
      arrivalId: "14",
      asOf: OBSERVED_AT,
      departureId: "5",
      departureTimes: [OBSERVED_AT + 3_600],
    });

    expect(result).toEqual([row()]);
    expect(observationModel.findAll).toHaveBeenCalledWith({
      order: [
        ["departureTime", "ASC"],
        ["receivedAt", "ASC"],
        ["id", "ASC"],
      ],
      where: {
        arrivalId: "14",
        departureId: "5",
        departureTime: { [Op.in]: [OBSERVED_AT + 3_600] },
        receivedAt: { [Op.lte]: OBSERVED_AT },
      },
    });
  });

  // delete only strict 400-day expiry in bounded batches
  it("purges expired ids without updating retained evidence", async () => {
    observationModel.findAll
      .mockResolvedValueOnce([{ id: "1" }, { id: "2" }])
      .mockResolvedValueOnce([]);
    observationModel.destroy.mockResolvedValue(2);

    const result = await purgeCapacityObservations({
      asOf: OBSERVED_AT,
      batchSize: 2,
      maxBatches: 3,
    });

    expect(result).toEqual({
      cutoff: OBSERVED_AT - CAPACITY_OBSERVATION_RETENTION_SECONDS,
      deleted: 2,
      exhaustedBatchBudget: false,
    });
    expect(observationModel.destroy).toHaveBeenCalledOnce();
    expect(observationModel.update).toBeUndefined();
  });

  // report when a bounded run may leave more work
  it("reports an exhausted batch budget", async () => {
    observationModel.findAll.mockResolvedValue([{ id: "1" }]);
    observationModel.destroy.mockResolvedValue(1);

    const result = await purgeCapacityObservations({
      asOf: OBSERVED_AT,
      batchSize: 1,
      maxBatches: 1,
    });

    expect(result.exhaustedBatchBudget).toBe(true);
  });
});
