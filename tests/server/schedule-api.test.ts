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
const updateEstimatesIsolated = vi.hoisted(() => vi.fn());
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

vi.mock("~/lib/forecastIsolation", () => ({
  updateEstimatesIsolated,
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
    updateEstimatesIsolated.mockReset();
    updateEstimatesIsolated.mockResolvedValue(undefined);
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
    expect(updateEstimatesIsolated).not.toHaveBeenCalled();
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
    expect(updateEstimatesIsolated).not.toHaveBeenCalled();
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
    updateSchedules.mockImplementation(() => {
      scheduleIsLoaded = true;
      return Promise.resolve();
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/10/2026-06-21")
      .expect(200);

    expect(updateSchedules).toHaveBeenCalledWith("2026-06-21", "1", "10");
    expect(updateEstimatesIsolated).not.toHaveBeenCalled();
    expect(response.body.schedule).toEqual(liveSchedule);
  });

  // slow live refresh case
  it("returns quickly while a missing live schedule refresh continues", async () => {
    scheduleModel.generateKey.mockReturnValue("1-11-2099-06-21");
    scheduleModel.getByIndex.mockReturnValue(null);
    updateSchedules.mockReturnValue(new Promise(() => undefined));
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/11/2099-06-21")
      .expect(503);

    expect(updateSchedules).toHaveBeenCalledWith("2099-06-21", "1", "11");
    expect(updateEstimatesIsolated).not.toHaveBeenCalled();
    expect(response.body).toEqual({ status: "refreshing" });
  });

  // future schedule forecast hydration
  it("forecasts cached future schedules before returning them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T18:30:00.000Z"));
    const estimate = {
      driveUpCapacity: 24,
      reservableCapacity: 0,
    };
    const futureSchedule = {
      date: "2026-06-22",
      forecastSourceUpdatedAt: null,
      key: "1-2-2026-06-22",
      mateId: "2",
      slots: [
        {
          allowsPassengers: true,
          allowsVehicles: true,
          hasPassed: false,
          mateId: "2",
          time: 1782151200,
          vessel: {
            abbreviation: "SAL",
            id: "66",
            name: "Salish",
            speed: 18,
            tallVehicleCapacity: 0,
            vehicleCapacity: 64,
            vesselWatchUrl: "https://example.com/salish",
          },
          wuid: "Mon-10-00",
        },
      ],
      sourceUpdatedAt: 1782070200,
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-22");
    scheduleModel.getByIndex.mockReturnValue(futureSchedule);
    updateEstimatesIsolated.mockImplementation((schedules) => {
      // forecast the requested future schedule
      schedules[0].slots[0].estimate = estimate;
      return Promise.resolve();
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/2/2026-06-22")
      .expect(200);

    expect(updateEstimatesIsolated).toHaveBeenCalledWith([futureSchedule]);
    expect(futureSchedule.forecastSourceUpdatedAt).toBe(1782070200);
    expect(response.body.schedule.slots[0].estimate).toEqual(estimate);
  });

  // slow future forecast case
  it("keeps future schedules refreshing until forecasts finish", async () => {
    const futureSchedule = {
      date: "2099-06-21",
      forecastSourceUpdatedAt: null,
      key: "1-12-2099-06-21",
      mateId: "12",
      slots: [{ allowsVehicles: true }],
      sourceUpdatedAt: 4_085_412_600,
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.generateKey.mockReturnValue("1-12-2099-06-21");
    scheduleModel.getByIndex.mockReturnValue(futureSchedule);
    updateEstimatesIsolated.mockReturnValue(new Promise(() => undefined));
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/12/2099-06-21")
      .expect(503);

    expect(updateEstimatesIsolated).toHaveBeenCalledWith([futureSchedule]);
    expect(response.body).toEqual({ status: "refreshing" });
  });

  // failed future forecast case
  it("does not return forecastless future schedules after a worker failure", async () => {
    const futureSchedule = {
      date: "2099-06-21",
      forecastSourceUpdatedAt: null,
      key: "1-13-2099-06-21",
      mateId: "13",
      slots: [{ allowsVehicles: true }],
      sourceUpdatedAt: 4_085_412_600,
      terminalId: "1",
      validRange: null,
    };
    scheduleModel.generateKey.mockReturnValue("1-13-2099-06-21");
    scheduleModel.getByIndex.mockReturnValue(futureSchedule);
    updateEstimatesIsolated.mockRejectedValue(
      new Error("forecast worker failed")
    );
    const app = createApp();

    const response = await request(app)
      .get("/api/schedule/1/13/2099-06-21")
      .expect(503);

    expect(response.body).toEqual({ status: "refreshing" });
    expect(response.body).not.toHaveProperty("schedule");
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
