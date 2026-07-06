import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleRouter } from "../../server/controllers/api/schedule";

const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getByIndex: vi.fn(),
  hasFetchedDate: vi.fn(),
}));

const updateSchedules = vi.hoisted(() => vi.fn());
const updateEstimates = vi.hoisted(() => vi.fn());
const wsfApi = vi.hoisted(() => ({
  getWsfStatus: vi.fn(),
}));
const crossingModel = vi.hoisted(() => ({
  findAll: vi.fn(),
}));
const vesselModel = vi.hoisted(() => ({
  getByIndex: vi.fn(),
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/models/Vessel", () => ({
  Vessel: vesselModel,
}));

vi.mock("~/lib/wsf/updateSchedules", () => ({
  updateSchedules,
}));

vi.mock("~/lib/forecast", () => ({
  updateEstimates,
}));

vi.mock("~/lib/wsf/api", () => wsfApi);

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
    vi.useRealTimers();
    scheduleModel.generateKey.mockReturnValue("1-2-2020-01-01");
    scheduleModel.getByIndex.mockReset();
    scheduleModel.hasFetchedDate.mockReset();
    updateSchedules.mockReset();
    updateSchedules.mockResolvedValue(undefined);
    updateEstimates.mockReset();
    updateEstimates.mockResolvedValue(undefined);
    wsfApi.getWsfStatus.mockReset();
    wsfApi.getWsfStatus.mockReturnValue({ coreReady: true });
    crossingModel.findAll.mockReset();
    crossingModel.findAll.mockResolvedValue([]);
    vesselModel.getByIndex.mockReset();
    vesselModel.getByIndex.mockReturnValue(null);
  });

  // restore clock
  afterEach(() => {
    vi.useRealTimers();
  });

  // cached schedule case
  it("returns cached schedules without blocking on WSDOT or estimates", async () => {
    const historicalSchedule = {
      date: "2020-01-01",
      key: "1-2-2020-01-01",
      mateId: "2",
      slots: [],
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.hasFetchedDate.mockReturnValue(false);
    const scheduleRecord = {
      // serialize fixture
      serialize: () => historicalSchedule,
    };
    scheduleModel.getByIndex.mockReturnValue(scheduleRecord);
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2020-01-01")
      .expect(200);

    expect(crossingModel.findAll).not.toHaveBeenCalled();
    expect(updateSchedules).not.toHaveBeenCalled();
    expect(updateEstimates).not.toHaveBeenCalled();
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

  // current service day cache case
  it("returns cached live schedules for the current WSF service day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T18:30:00.000Z"));
    const liveSchedule = {
      date: "2026-06-21",
      key: "1-2-2026-06-21",
      mateId: "2",
      slots: [],
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-21");
    scheduleModel.hasFetchedDate.mockReturnValue(false);
    const scheduleRecord = {
      // serialize fixture
      serialize: () => liveSchedule,
    };
    scheduleModel.getByIndex.mockReturnValue(scheduleRecord);
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2026-06-21")
      .expect(200);

    expect(crossingModel.findAll).not.toHaveBeenCalled();
    expect(updateSchedules).not.toHaveBeenCalled();
    expect(updateEstimates).not.toHaveBeenCalled();
    expect(response.body.schedule).toEqual(liveSchedule);
  });

  // missing pair cache case
  it("fetches a requested live pair when another schedule already exists for the date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T18:30:00.000Z"));
    const liveSchedule = {
      date: "2026-06-21",
      key: "1-10-2026-06-21",
      mateId: "10",
      slots: [],
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.generateKey.mockReturnValue("1-10-2026-06-21");
    scheduleModel.hasFetchedDate.mockReturnValue(true);
    const scheduleRecord = {
      // serialize fixture
      serialize: () => liveSchedule,
    };
    let scheduleIsLoaded = false;
    scheduleModel.getByIndex.mockImplementation(() => {
      // refreshed schedule guard
      if (scheduleIsLoaded) {
        return scheduleRecord;
      }
      return null;
    });
    updateSchedules.mockImplementation(async () => {
      scheduleIsLoaded = true;
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/10/2026-06-21")
      .expect(200);

    expect(updateSchedules).toHaveBeenCalledWith("2026-06-21", "1", "10");
    expect(updateEstimates).toHaveBeenCalledWith([scheduleRecord]);
    expect(response.body.schedule).toEqual(liveSchedule);
  });

  // slow live refresh case
  it("returns quickly while a missing live schedule refresh continues", async () => {
    scheduleModel.generateKey.mockReturnValue("1-11-2099-06-21");
    scheduleModel.getByIndex.mockReturnValue(null);
    updateSchedules.mockReturnValue(new Promise(() => {}));
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/11/2099-06-21")
      .expect(503);

    expect(updateSchedules).toHaveBeenCalledWith("2099-06-21", "1", "11");
    expect(updateEstimates).not.toHaveBeenCalled();
    expect(response.body).toEqual({ status: "refreshing" });
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
        name: "Unknown vessel",
        vehicleCapacity: 100,
      },
    });
  });

  // historical vessel lookup case
  it("returns stored historical vessel assignments when the vessel is cached", async () => {
    const vessel = {
      id: "66",
      name: "Salish",
      // serialize vessel fixture
      serialize: () => ({
        abbreviation: "Sal",
        id: "66",
        name: "Salish",
        tallVehicleCapacity: 0,
        vehicleCapacity: 64,
        vesselWatchUrl: "https://example.com/salish",
      }),
    };
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
        totalCapacity: 64,
        vesselId: "66",
        vesselName: "Salish",
      }),
      totalCapacity: 64,
      vesselId: "66",
      vesselName: "Salish",
    };
    scheduleModel.hasFetchedDate.mockReturnValue(true);
    scheduleModel.getByIndex.mockReturnValue(null);
    crossingModel.findAll.mockResolvedValue([crossing]);
    vesselModel.getByIndex.mockReturnValue(vessel);
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2020-01-01")
      .expect(200);

    expect(vesselModel.getByIndex).toHaveBeenCalledWith("66");
    expect(response.body.schedule.slots[0].vessel).toMatchObject({
      id: "66",
      name: "Salish",
      vehicleCapacity: 64,
    });
  });
});
