import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleRouter } from "../../server/controllers/api/schedule";

const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getByIndex: vi.fn(),
  hasFetchedDate: vi.fn(),
}));

const updateSchedules = vi.hoisted(() => vi.fn());
const updateEstimates = vi.hoisted(() => vi.fn());
const crossingModel = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/lib/wsf/updateSchedules", () => ({
  updateSchedules,
}));

vi.mock("~/lib/forecast", () => ({
  updateEstimates,
}));

vi.mock("~/lib/wsf/date", () => ({
  toWsfDate: () => "2026-06-20",
}));

// create test app
const createApp = (): express.Express => {
  const app = express();
  app.use("/api/schedule", scheduleRouter);
  return app;
};

describe("schedule API", () => {
  // reset mocks
  beforeEach(() => {
    scheduleModel.generateKey.mockReturnValue("1-2-2020-01-01");
    scheduleModel.getByIndex.mockReset();
    scheduleModel.hasFetchedDate.mockReset();
    updateSchedules.mockReset();
    updateEstimates.mockReset();
    crossingModel.findAll.mockReset();
    crossingModel.findAll.mockResolvedValue([]);
  });

  // historical schedule case
  it("fills and returns schedules for past dates", async () => {
    const historicalSchedule = {
      date: "2020-01-01",
      key: "1-2-2020-01-01",
      mateId: "2",
      slots: [],
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.hasFetchedDate.mockReturnValue(false);
    scheduleModel.getByIndex.mockReturnValue({
      // serialize fixture
      serialize: () => historicalSchedule,
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2020-01-01")
      .expect(200);

    expect(updateSchedules).toHaveBeenCalledWith("2020-01-01", "1", "2");
    expect(updateEstimates).toHaveBeenCalledOnce();
    expect(scheduleModel.generateKey).toHaveBeenCalledWith(
      "1",
      "2",
      "2020-01-01"
    );
    expect(response.body).toEqual({
      schedule: historicalSchedule,
      timestamp: expect.any(Number),
    });
  });

  // crossing fallback case
  it("returns historical crossings when WSF has no schedule", async () => {
    const crossing = {
      arrivalId: "2",
      departureId: "1",
      departureTime: 1577890800,
      driveUpCapacity: 42,
      hasDriveUp: true,
      hasReservations: false,
      isCancelled: false,
      reservableCapacity: 0,
      toJSON: () => ({
        arrivalId: "2",
        departureId: "1",
        departureTime: 1577890800,
        driveUpCapacity: 42,
        hasDriveUp: true,
        hasReservations: false,
        isCancelled: false,
        reservableCapacity: 0,
        totalCapacity: 100,
      }),
      totalCapacity: 100,
    };
    scheduleModel.hasFetchedDate.mockReturnValue(true);
    scheduleModel.getByIndex.mockReturnValue(null);
    crossingModel.findAll.mockResolvedValue([crossing]);
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2020-01-01")
      .expect(200);

    expect(crossingModel.findAll).toHaveBeenCalledOnce();
    expect(updateSchedules).not.toHaveBeenCalled();
    expect(response.body.schedule.slots).toHaveLength(1);
    expect(response.body.schedule.slots[0]).toMatchObject({
      crossing: crossing.toJSON(),
      hasPassed: true,
      mateId: "2",
      time: 1577890800,
      vessel: {
        name: "Historical sailing",
        vehicleCapacity: 100,
      },
    });
  });
});
