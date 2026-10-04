import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crossingModel = vi.hoisted(() => ({
  findOrCreate: vi.fn(),
  update: vi.fn(),
}));
const capacityObservationModel = vi.hoisted(() => ({ bulkCreate: vi.fn() }));
const database = vi.hoisted(() => ({ transaction: vi.fn() }));
const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getByIndex: vi.fn(),
}));
const vesselModel = vi.hoisted(() => ({ getByIndex: vi.fn() }));
const wsfApi = vi.hoisted(() => ({ wsfRequest: vi.fn() }));
const scheduleUpdates = vi.hoisted(() => ({
  getPreviousCrossing: vi.fn(),
}));
const wsfDates = vi.hoisted(() => ({
  toWsfDate: vi.fn(),
  wsfDateToTimestamp: vi.fn(),
}));

vi.mock("~/lib/logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/db")>();
  actual.db.transaction = database.transaction;
  return actual;
});
vi.mock("~/models/CapacityObservation", () => ({
  default: capacityObservationModel,
}));
vi.mock("~/models/Crossing", () => ({ default: crossingModel }));
vi.mock("~/models/Schedule", () => ({ Schedule: scheduleModel }));
vi.mock("~/models/Vessel", () => ({ Vessel: vesselModel }));
vi.mock("../../server/lib/wsf/api", () => wsfApi);
vi.mock("../../server/lib/wsf/updateSchedules", () => scheduleUpdates);
vi.mock("../../server/lib/wsf/date", () => wsfDates);

const {
  getCapacityReportingStartedAt,
  getCapacityReportingState,
  getReportedAvailableCapacity,
  updateCapacity,
} = await import("../../server/lib/wsf/updateCapacity");

const OBSERVED_AT = 1_788_200_000;
const DEPARTURE_AT = OBSERVED_AT + 3_600;
// represent the production transaction callback contract
const DEFAULT_TRANSACTION = { id: "default-transaction" };

// build a coherent cached schedule double
const scheduleWithSlot = (slot: Record<string, unknown>) => {
  Object.assign(slot, {
    allowsPassengers: true,
    allowsVehicles: true,
    hasPassed: false,
    mateId: "14",
    time: DEPARTURE_AT,
    vessel: slot.vessel ?? {},
    wuid: "capacity-test-slot",
  });
  return {
    getSlot: vi.fn().mockReturnValue(slot),
    key: "schedule-key",
    slots: [slot],
  };
};

// build one raw WSF response
const capacityResponse = (
  driveUpCapacity: number,
  displayReservableSpace = false
) => [
  {
    DepartingSpaces: [
      {
        Departure: "/Date(0)/",
        IsCancelled: false,
        SpaceForArrivalTerminals: [
          {
            ArrivalTerminalIDs: [14],
            DisplayDriveUpSpace: true,
            DisplayReservableSpace: displayReservableSpace,
            DriveUpSpaceCount: driveUpCapacity,
            MaxSpaceCount: 120,
          },
        ],
        VesselID: 15,
      },
    ],
    TerminalID: 5,
  },
];

describe("WSF capacity reporting start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(OBSERVED_AT * 1_000);
    crossingModel.findOrCreate.mockReset();
    crossingModel.update.mockReset().mockResolvedValue([1]);
    capacityObservationModel.bulkCreate.mockReset().mockResolvedValue([]);
    database.transaction
      .mockReset()
      .mockImplementation((callback) => callback(DEFAULT_TRANSACTION));
    scheduleModel.generateKey.mockReset().mockReturnValue("schedule-key");
    scheduleModel.getByIndex.mockReset();
    vesselModel.getByIndex.mockReset().mockReturnValue({
      departureDelta: 0,
      name: "Issaquah",
    });
    wsfApi.wsfRequest.mockReset();
    scheduleUpdates.getPreviousCrossing.mockReset().mockResolvedValue(null);
    wsfDates.toWsfDate.mockReset().mockReturnValue("2026-08-31");
    wsfDates.wsfDateToTimestamp.mockReset().mockReturnValue(DEPARTURE_AT);
  });

  // timer cleanup
  afterEach(() => {
    vi.useRealTimers();
  });

  // normalize raw WSF optional components
  it.each([
    [true, 80, false, undefined, 80],
    [true, 60, true, 20, 80],
    [false, undefined, true, 20, 20],
    [false, undefined, false, undefined, null],
    [true, undefined, false, undefined, null],
    [false, undefined, true, undefined, null],
  ])(
    "maps displayed drive-up %s and reservations %s to %s",
    (displayDriveUp, driveUp, displayReservations, reservations, expected) => {
      expect(
        getReportedAvailableCapacity({
          DisplayDriveUpSpace: displayDriveUp,
          DisplayReservableSpace: displayReservations,
          DriveUpSpaceCount: driveUp,
          ReservableSpaceCount: reservations,
        })
      ).toBe(expected);
    }
  );

  // keep reporting placeholders distinct from active evidence
  it.each([
    {
      displayed: false,
      driveUp: 120,
      reportedAvailable: null,
      startedAt: null,
      state: "hidden",
    },
    {
      displayed: true,
      driveUp: undefined,
      reportedAvailable: null,
      startedAt: null,
      state: "unknown",
    },
    {
      displayed: true,
      driveUp: 120,
      reportedAvailable: 120,
      startedAt: null,
      state: "inactive-all-open",
    },
    {
      displayed: true,
      driveUp: 80,
      reportedAvailable: 80,
      startedAt: OBSERVED_AT,
      state: "active",
    },
  ])(
    "classifies $state reporting state",
    ({ displayed, driveUp, reportedAvailable, startedAt, state }) => {
      expect(
        getCapacityReportingState({
          capacityReportingStartedAt: startedAt,
          reportedAvailable,
          spaceData: {
            DisplayDriveUpSpace: displayed,
            DisplayReservableSpace: false,
            DriveUpSpaceCount: driveUp,
            MaxSpaceCount: 120,
          },
        })
      ).toBe(state);
    }
  );

  // cover the complete monotonic transition table
  it.each([
    { available: 120, current: null, expected: null, total: 120 },
    { available: 119, current: null, expected: OBSERVED_AT, total: 120 },
    { available: 120, current: undefined, expected: null, total: 120 },
    { available: 80, current: undefined, expected: OBSERVED_AT, total: 120 },
    { available: 60, current: 123, expected: 123, total: 120 },
    { available: 120, current: 123, expected: 123, total: 120 },
    { available: 130, current: 123, expected: 123, total: 120 },
    { available: 0, current: null, expected: null, total: 0 },
    { available: null, current: null, expected: null, total: 120 },
    { available: 100, current: null, expected: OBSERVED_AT, total: 120 },
  ])(
    "maps $available/$total with $current to $expected",
    ({ available, current, expected, total }) => {
      expect(
        getCapacityReportingStartedAt({
          capacityReportingStartedAt: current,
          observedAt: OBSERVED_AT,
          reportedAvailable: available,
          totalCapacity: total,
        })
      ).toBe(expected);
    }
  );

  // create and link a below-max crossing
  it("persists start state from a partial-display create payload", async () => {
    const slot: { crossing?: unknown } = {};
    const schedule = scheduleWithSlot(slot);
    const crossing = { isEmpty: vi.fn().mockReturnValue(false) };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    crossingModel.findOrCreate.mockResolvedValue([crossing, true]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    const affected = await updateCapacity();

    expect(crossingModel.findOrCreate).toHaveBeenCalledWith({
      defaults: expect.objectContaining({
        capacityReportUpdatedAt: OBSERVED_AT,
        capacityReportingStartedAt: OBSERVED_AT,
        driveUpCapacity: 80,
        hasDriveUp: true,
        hasReservations: false,
        reservableCapacity: undefined,
      }),
      transaction: DEFAULT_TRANSACTION,
      where: {
        arrivalId: "14",
        departureId: "5",
        departureTime: DEPARTURE_AT,
      },
    });
    expect(schedule.getSlot).toHaveBeenCalledWith(DEPARTURE_AT);
    expect(slot.crossing).toBe(crossing);
    expect(affected).toEqual([schedule]);
  });

  // persist the physical group before any mutable crossing row
  it("appends one direct row per arrival with shared physical identity", async () => {
    const response = capacityResponse(80);
    const [arrivalSpace] =
      response[0].DepartingSpaces[0].SpaceForArrivalTerminals;
    arrivalSpace.ArrivalTerminalIDs = [14, 15];
    crossingModel.findOrCreate.mockResolvedValue([
      { isEmpty: vi.fn().mockReturnValue(false) },
      true,
    ]);
    wsfApi.wsfRequest.mockResolvedValue(response);

    await updateCapacity();

    const [rows] = capacityObservationModel.bulkCreate.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      arrivalId: "14",
      driveUpSpaces: 80,
      providerReportedAt: null,
      reportingStateAtReceipt: "active",
      sourceKind: "wsf-direct",
      usableForFillLabel: true,
    });
    expect(rows[1].arrivalId).toBe("15");
    expect(rows[0].pollId).toBe(rows[1].pollId);
    expect(rows[0].allocationGroupId).toBe(rows[1].allocationGroupId);
    expect(rows[0].allocationGroupId).toEqual(expect.any(String));
    expect(
      capacityObservationModel.bulkCreate.mock.invocationCallOrder[0]
    ).toBeLessThan(crossingModel.findOrCreate.mock.invocationCallOrder[0]);
  });

  // reuse generated identities across a transaction retry
  it("keeps poll and allocation ids stable across retry", async () => {
    const retryTransaction = { id: "retry" };
    database.transaction.mockImplementation(async (callback) => {
      // retry one failed transaction callback
      try {
        return await callback(retryTransaction);
      } catch {
        return callback(retryTransaction);
      }
    });
    crossingModel.findOrCreate
      .mockRejectedValueOnce(new Error("retryable"))
      .mockResolvedValueOnce([
        { isEmpty: vi.fn().mockReturnValue(false) },
        true,
      ]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    const [firstRows] = capacityObservationModel.bulkCreate.mock.calls[0];
    const [secondRows] = capacityObservationModel.bulkCreate.mock.calls[1];
    expect(secondRows[0].pollId).toBe(firstRows[0].pollId);
    expect(secondRows[0].allocationGroupId).toBe(
      firstRows[0].allocationGroupId
    );
  });

  // defer in-memory schedule linkage until commit
  it("does not link a slot after a failed crossing update", async () => {
    const slot: { crossing?: unknown } = {};
    const schedule = scheduleWithSlot(slot);
    const crossing = {
      capacityReportingStartedAt: null,
      departureDelta: null,
      update: vi.fn().mockRejectedValue(new Error("write failed")),
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await expect(updateCapacity()).rejects.toThrow("write failed");

    expect(capacityObservationModel.bulkCreate).toHaveBeenCalledOnce();
    expect(slot.crossing).toBeUndefined();
  });

  // update start once and preserve it
  it("transitions an existing crossing once and keeps the first timestamp", async () => {
    const slot: { crossing?: unknown } = {};
    const schedule = scheduleWithSlot(slot);
    const crossing = {
      capacityReportingStartedAt: null as number | null,
      isEmpty: vi.fn().mockReturnValue(false),
      update: vi.fn().mockImplementation((values) => {
        Object.assign(crossing, values);
        return Promise.resolve();
      }),
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest
      .mockResolvedValueOnce(capacityResponse(80))
      .mockResolvedValueOnce(capacityResponse(120));

    await updateCapacity();
    vi.setSystemTime((OBSERVED_AT + 60) * 1_000);
    await updateCapacity();

    expect(crossing.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        capacityReportUpdatedAt: OBSERVED_AT,
        capacityReportingStartedAt: OBSERVED_AT,
      }),
      { transaction: DEFAULT_TRANSACTION }
    );
    expect(crossing.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capacityReportUpdatedAt: OBSERVED_AT + 60,
        capacityReportingStartedAt: OBSERVED_AT,
      }),
      { transaction: DEFAULT_TRANSACTION }
    );
    expect(crossing.capacityReportingStartedAt).toBe(OBSERVED_AT);
    expect(slot.crossing).toBe(crossing);
  });

  // preserve delayed previous-sailing repair
  it("marks a qualifying delayed previous crossing full", async () => {
    const schedule = scheduleWithSlot({});
    const crossing = { isEmpty: vi.fn().mockReturnValue(false) };
    const previousCrossing = {
      arrivalId: "14",
      capacityReportingStartedAt: OBSERVED_AT - 60,
      departureDelta: 0,
      departureId: "5",
      departureTime: DEPARTURE_AT - 60 * 60,
      driveUpCapacity: 12,
      hasDriveUp: true,
      hasPassed: vi.fn().mockReturnValue(false),
      hasReservations: false,
      isFull: vi.fn().mockReturnValue(false),
      isCancelled: false,
      reservableCapacity: 4,
      totalCapacity: 120,
      vesselId: "15",
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    crossingModel.findOrCreate.mockResolvedValue([crossing, true]);
    scheduleUpdates.getPreviousCrossing.mockResolvedValue(previousCrossing);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossingModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          capacityReportUpdatedAt: OBSERVED_AT,
        }),
      })
    );
    expect(crossingModel.update).toHaveBeenCalledWith(
      { driveUpCapacity: 0, reservableCapacity: 0 },
      expect.objectContaining({
        transaction: DEFAULT_TRANSACTION,
        where: {
          arrivalId: "14",
          departureId: "5",
          departureTime: DEPARTURE_AT - 60 * 60,
        },
      })
    );
    expect(previousCrossing.driveUpCapacity).toBe(0);
    expect(previousCrossing.reservableCapacity).toBe(0);
    const [repairRows] = capacityObservationModel.bulkCreate.mock.calls[1];
    expect(repairRows[0]).toMatchObject({
      allocationGroupId: null,
      repairReason: "delayed-predecessor-missing",
      sourceKind: "repair-derived",
      triggerPollId: expect.any(String),
      usableForFillLabel: false,
    });
    expect(
      capacityObservationModel.bulkCreate.mock.invocationCallOrder[1]
    ).toBeLessThan(crossingModel.update.mock.invocationCallOrder[0]);
  });

  // leave cached predecessor capacity unchanged after group rollback
  it("stages predecessor cache repair until every arrival commits", async () => {
    const transaction = { id: "group-transaction" };
    database.transaction.mockImplementation((callback) =>
      callback(transaction)
    );
    const response = capacityResponse(80);
    const [arrivalSpace] =
      response[0].DepartingSpaces[0].SpaceForArrivalTerminals;
    arrivalSpace.ArrivalTerminalIDs = [14, 15];
    const schedule = scheduleWithSlot({});
    const crossing = {
      capacityReportingStartedAt: null,
      departureDelta: null,
      isEmpty: vi.fn().mockReturnValue(false),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const previousCrossing = {
      arrivalId: "14",
      capacityReportingStartedAt: OBSERVED_AT - 60,
      departureDelta: 0,
      departureId: "5",
      departureTime: DEPARTURE_AT - 60 * 60,
      driveUpCapacity: 12,
      hasDriveUp: true,
      hasPassed: vi.fn().mockReturnValue(false),
      hasReservations: false,
      isCancelled: false,
      isFull: vi.fn().mockReturnValue(false),
      reservableCapacity: 4,
      totalCapacity: 120,
      vesselId: "15",
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    crossingModel.findOrCreate
      .mockResolvedValueOnce([crossing, false])
      .mockRejectedValueOnce(new Error("second arrival failed"));
    scheduleUpdates.getPreviousCrossing.mockResolvedValue(previousCrossing);
    wsfApi.wsfRequest.mockResolvedValue(response);

    await expect(updateCapacity()).rejects.toThrow("second arrival failed");

    expect(capacityObservationModel.bulkCreate).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      { ignoreDuplicates: true, transaction }
    );
    expect(crossingModel.findOrCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ transaction })
    );
    expect(crossing.update).toHaveBeenCalledWith(expect.any(Object), {
      transaction,
    });
    expect(capacityObservationModel.bulkCreate).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: "repair-derived" }),
      ]),
      { ignoreDuplicates: true, transaction }
    );
    expect(crossingModel.update).toHaveBeenCalledWith(
      { driveUpCapacity: 0, reservableCapacity: 0 },
      expect.objectContaining({ transaction })
    );
    expect(crossingModel.findOrCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ transaction })
    );
    expect(previousCrossing.driveUpCapacity).toBe(12);
    expect(previousCrossing.reservableCapacity).toBe(4);
  });

  // record the matched crossing event and authoritative vessel
  it("records matched departure delay and replaces the scheduled vessel", async () => {
    vi.setSystemTime((DEPARTURE_AT + 10 * 60) * 1_000);
    const scheduledVessel = { id: "scheduled-vessel" };
    const capacityVessel = {
      arrivingTerminalId: "14",
      departedTime: DEPARTURE_AT + 8 * 60,
      departureDelta: 45 * 60,
      departingTerminalId: 5,
      name: "Issaquah",
      scheduledDepartureTime: DEPARTURE_AT,
    };
    const slot: { crossing?: unknown; vessel: unknown } = {
      vessel: scheduledVessel,
    };
    const schedule = scheduleWithSlot(slot);
    const crossing = {
      capacityReportingStartedAt: null,
      departureDelta: null,
      isEmpty: vi.fn().mockReturnValue(false),
      update: vi.fn().mockResolvedValue(undefined),
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    vesselModel.getByIndex.mockReturnValue(capacityVessel);
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        departureDelta: 8 * 60,
        vesselId: "15",
        vesselName: "Issaquah",
      }),
      { transaction: DEFAULT_TRANSACTION }
    );
    expect(slot.crossing).toBe(crossing);
    expect(slot.vessel).toBe(capacityVessel);
  });

  // share one departure across a through-sailing's destinations
  it("records the same departure delay for downstream arrival terminals", async () => {
    vi.setSystemTime((DEPARTURE_AT + 10 * 60) * 1_000);
    const response = capacityResponse(80);
    response[0].TerminalID = 1;
    const [arrivalSpace] =
      response[0].DepartingSpaces[0].SpaceForArrivalTerminals;
    arrivalSpace.ArrivalTerminalIDs = [13, 10];
    vesselModel.getByIndex.mockReturnValue({
      arrivingTerminalId: 13,
      departedTime: DEPARTURE_AT + 8 * 60,
      departingTerminalId: 1,
      name: "Issaquah",
      scheduledDepartureTime: DEPARTURE_AT,
    });
    crossingModel.findOrCreate.mockResolvedValue([{}, true]);
    wsfApi.wsfRequest.mockResolvedValue(response);

    await updateCapacity();

    // both destinations share the origin's departure event
    for (const arrivalId of ["13", "10"]) {
      expect(crossingModel.findOrCreate).toHaveBeenCalledWith({
        defaults: expect.objectContaining({
          arrivalId,
          departureDelta: 8 * 60,
          departureId: "1",
          departureTime: DEPARTURE_AT,
        }),
        transaction: DEFAULT_TRANSACTION,
        where: { arrivalId, departureId: "1", departureTime: DEPARTURE_AT },
      });
    }
  });

  // retain scheduled assignment without capacity vessel metadata
  it("keeps the scheduled vessel and null delay for an unknown capacity vessel", async () => {
    const scheduledVessel = { id: "scheduled-vessel" };
    const slot: { crossing?: unknown; vessel: unknown } = {
      vessel: scheduledVessel,
    };
    const schedule = scheduleWithSlot(slot);
    const crossing = { isEmpty: vi.fn().mockReturnValue(false) };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    vesselModel.getByIndex.mockReturnValue(undefined);
    crossingModel.findOrCreate.mockResolvedValue([crossing, true]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossingModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          departureDelta: null,
          vesselId: "15",
          vesselName: null,
        }),
      })
    );
    expect(slot.crossing).toBe(crossing);
    expect(slot.vessel).toBe(scheduledVessel);
  });

  // reject stale or unrelated vessel departure events
  it.each([
    {
      arrivingTerminalId: 5,
      departedTime: DEPARTURE_AT + 8 * 60,
      departingTerminalId: 14,
      label: "simultaneous reverse-direction sailing",
      scheduledDepartureTime: DEPARTURE_AT,
    },
    {
      arrivingTerminalId: 14,
      departedTime: DEPARTURE_AT - 60 * 60 + 8 * 60,
      departingTerminalId: 5,
      label: "earlier sailing",
      scheduledDepartureTime: DEPARTURE_AT - 60 * 60,
    },
    {
      arrivingTerminalId: 14,
      departedTime: DEPARTURE_AT + 60 * 60 + 8 * 60,
      departingTerminalId: 5,
      label: "future sailing",
      scheduledDepartureTime: DEPARTURE_AT + 60 * 60,
    },
    {
      arrivingTerminalId: 14,
      departedTime: Number.NaN,
      departingTerminalId: 5,
      label: "invalid actual departure",
      scheduledDepartureTime: DEPARTURE_AT,
    },
    {
      arrivingTerminalId: 14,
      departedTime: DEPARTURE_AT + 4 * 60 * 60,
      departingTerminalId: 5,
      label: "not-yet-observed departure",
      scheduledDepartureTime: DEPARTURE_AT,
    },
    {
      arrivingTerminalId: 14,
      departedTime: DEPARTURE_AT - 11 * 60,
      departingTerminalId: 5,
      label: "rolled-forward early departure",
      scheduledDepartureTime: DEPARTURE_AT,
    },
  ])("does not copy delay from a $label", async (vesselStatus) => {
    vi.setSystemTime((DEPARTURE_AT + 3 * 60 * 60) * 1_000);
    const schedule = scheduleWithSlot({});
    const crossing = { isEmpty: vi.fn().mockReturnValue(false) };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    vesselModel.getByIndex.mockReturnValue({
      ...vesselStatus,
      departureDelta: 45 * 60,
      name: "Issaquah",
    });
    crossingModel.findOrCreate.mockResolvedValue([crossing, true]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossingModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ departureDelta: null }),
      })
    );
  });

  // discard unobserved legacy projections without fabricating history
  it("clears an inherited delay whose departure has not happened yet", async () => {
    const crossing = {
      capacityReportingStartedAt: OBSERVED_AT - 60,
      departureDelta: 45 * 60,
      update: vi.fn().mockResolvedValue(undefined),
    };
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossing.update).toHaveBeenCalledWith(
      expect.objectContaining({ departureDelta: null }),
      { transaction: DEFAULT_TRANSACTION }
    );
  });

  // discard old WSF rollover artifacts
  it("clears a stored departure more than five minutes before its slot", async () => {
    vi.setSystemTime((DEPARTURE_AT + 10 * 60) * 1_000);
    const crossing = {
      capacityReportingStartedAt: OBSERVED_AT - 60,
      departureDelta: -11 * 60,
      update: vi.fn().mockResolvedValue(undefined),
    };
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossing.update).toHaveBeenCalledWith(
      expect.objectContaining({ departureDelta: null }),
      { transaction: DEFAULT_TRANSACTION }
    );
  });

  // preserve confirmed history when live status no longer matches
  it("preserves an existing confirmed delay for an unmatched vessel event", async () => {
    vi.setSystemTime((DEPARTURE_AT + 2 * 60 * 60) * 1_000);
    const schedule = scheduleWithSlot({});
    const crossing = {
      capacityReportingStartedAt: OBSERVED_AT - 60,
      departureDelta: 7 * 60,
      isEmpty: vi.fn().mockReturnValue(false),
      // mirror model updates
      update: vi.fn().mockImplementation((values) => {
        Object.assign(crossing, values);
        return Promise.resolve();
      }),
    };
    scheduleModel.getByIndex.mockReturnValue(schedule);
    vesselModel.getByIndex.mockReturnValue({
      arrivingTerminalId: 14,
      departedTime: DEPARTURE_AT + 60 * 60 + 45 * 60,
      departureDelta: 45 * 60,
      departingTerminalId: 5,
      name: "Issaquah",
      scheduledDepartureTime: DEPARTURE_AT + 60 * 60,
    });
    crossingModel.findOrCreate.mockResolvedValue([crossing, false]);
    wsfApi.wsfRequest.mockResolvedValue(capacityResponse(80));

    await updateCapacity();

    expect(crossing.update).toHaveBeenCalledWith(
      expect.objectContaining({ departureDelta: 7 * 60 }),
      { transaction: DEFAULT_TRANSACTION }
    );
    expect(crossing.departureDelta).toBe(7 * 60);
  });
});
