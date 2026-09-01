import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crossingModel = vi.hoisted(() => ({ findOrCreate: vi.fn() }));
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

vi.mock("~/models/Crossing", () => ({ default: crossingModel }));
vi.mock("~/models/Schedule", () => ({ Schedule: scheduleModel }));
vi.mock("~/models/Vessel", () => ({ Vessel: vesselModel }));
vi.mock("../../server/lib/wsf/api", () => wsfApi);
vi.mock("../../server/lib/wsf/updateSchedules", () => scheduleUpdates);
vi.mock("../../server/lib/wsf/date", () => wsfDates);

const {
  getCapacityReportingStartedAt,
  getReportedAvailableCapacity,
  updateCapacity,
} = await import("../../server/lib/wsf/updateCapacity");

const OBSERVED_AT = 1_788_200_000;
const DEPARTURE_AT = OBSERVED_AT + 3_600;

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
    const schedule = {
      getSlot: vi.fn().mockReturnValue(slot),
      key: "schedule-key",
    };
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

  // update start once and preserve it
  it("transitions an existing crossing once and keeps the first timestamp", async () => {
    const slot: { crossing?: unknown } = {};
    const schedule = {
      getSlot: vi.fn().mockReturnValue(slot),
      key: "schedule-key",
    };
    const crossing = {
      capacityReportingStartedAt: null as number | null,
      isEmpty: vi.fn().mockReturnValue(false),
      update: vi.fn().mockImplementation(async (values) => {
        Object.assign(crossing, values);
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
      })
    );
    expect(crossing.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capacityReportUpdatedAt: OBSERVED_AT + 60,
        capacityReportingStartedAt: OBSERVED_AT,
      })
    );
    expect(crossing.capacityReportingStartedAt).toBe(OBSERVED_AT);
    expect(slot.crossing).toBe(crossing);
  });

  // preserve delayed previous-sailing repair
  it("marks a qualifying delayed previous crossing full", async () => {
    const schedule = {
      getSlot: vi.fn().mockReturnValue({}),
      key: "schedule-key",
    };
    const crossing = { isEmpty: vi.fn().mockReturnValue(false) };
    const previousCrossing = {
      hasPassed: vi.fn().mockReturnValue(false),
      isFull: vi.fn().mockReturnValue(false),
      update: vi.fn().mockResolvedValue(undefined),
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
    expect(previousCrossing.update).toHaveBeenCalledWith({
      driveUpCapacity: 0,
      reservableCapacity: 0,
    });
  });
});
