import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scheduleModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const crossingModel = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  getByIndex: vi.fn(),
}));

const holidayModel = vi.hoisted(() => ({
  getWashingtonHolidayDates: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/models/Terminal", () => ({
  Terminal: terminalModel,
}));

vi.mock("~/lib/holidays", () => holidayModel);

const { updateEstimates } = await import("../../server/lib/forecast");

const terminal = {
  id: "1",
  location: {
    address: {},
    latitude: 47.60249,
    longitude: -122.33987,
  },
};

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const createCrossing = (input: Record<string, unknown>) => ({
  arrivalId: "2",
  departureDelta: null,
  departureId: "1",
  departureTime: toSeconds("2026-06-21T12:00:00"),
  driveUpCapacity: 80,
  hasDriveUp: true,
  hasReservations: true,
  isCancelled: false,
  reservableCapacity: 20,
  totalCapacity: 100,
  ...input,
});

const createSchedule = (slot: Record<string, unknown>) => ({
  date: "2026-06-21",
  key: "1-2-2026-06-21",
  mateId: "2",
  slots: [
    {
      allowsPassengers: true,
      allowsVehicles: true,
      hasPassed: false,
      mateId: "2",
      time: toSeconds("2026-06-21T12:00:00"),
      vessel: { id: "vessel", tallVehicleCapacity: 0, vehicleCapacity: 100 },
      wuid: "slot",
      ...slot,
    },
  ],
  terminalId: "1",
  validRange: null,
});

describe("forecast estimates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T17:00:00.000Z"));
    scheduleModel.getAll.mockReset();
    crossingModel.findAll.mockReset();
    terminalModel.getByIndex.mockReset();
    holidayModel.getWashingtonHolidayDates.mockReset();
    terminalModel.getByIndex.mockReturnValue(terminal);
    holidayModel.getWashingtonHolidayDates.mockResolvedValue(new Set());
  });

  // timer cleanup
  afterEach(() => {
    vi.useRealTimers();
  });

  // blend behavior
  it("blends live capacity with recency-weighted historical outcomes", async () => {
    const liveCrossing = createCrossing({});
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-07T12:00:00"),
        driveUpCapacity: 40,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-20T12:00:00"),
        driveUpCapacity: 90,
        reservableCapacity: 10,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-21T12:00:00"),
        driveUpCapacity: 10,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      confidence: "medium",
      sampleSize: 2,
      source: "blended",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeLessThan(80);
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeGreaterThan(20);
  });

  // holiday behavior
  it("weights matching holiday history over ordinary same-weekday history", async () => {
    const schedule = createSchedule({
      time: toSeconds("2026-07-04T12:00:00"),
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    holidayModel.getWashingtonHolidayDates.mockImplementation(
      async (year: number) =>
        new Set(year === 2026 ? ["2026-07-04"] : ["2025-07-04"])
    );
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2025-07-04T12:00:00"),
        driveUpCapacity: 5,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-20T12:00:00"),
        driveUpCapacity: 80,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      sampleSize: 2,
      source: "historical",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeLessThan(50);
  });

  // disruption behavior
  it("marks cancelled sailings as low-confidence disruption forecasts", async () => {
    const liveCrossing = createCrossing({ isCancelled: true });
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      confidence: "low",
      driveUpCapacity: 80,
      reservableCapacity: 20,
      source: "disruption",
    });
  });
});
