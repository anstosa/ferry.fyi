import { describe, expect, it, vi } from "vitest";

const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getByIndex: vi.fn(),
}));
const crossingModel = vi.hoisted(() => ({ findAll: vi.fn() }));
const vesselModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
}));
const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
}));
const routeModel = vi.hoisted(() => ({
  getByIndex: vi.fn(),
  getByTerminalId: vi.fn(),
}));
const wsfApi = vi.hoisted(() => ({ getWsfStatus: vi.fn() }));
const wsfSchedules = vi.hoisted(() => ({ updateSchedules: vi.fn() }));

vi.mock("~/models/Schedule", () => ({ Schedule: scheduleModel }));
vi.mock("~/models/Crossing", () => ({ default: crossingModel }));
vi.mock("~/models/Vessel", () => ({ Vessel: vesselModel }));
vi.mock("~/models/Terminal", () => ({ Terminal: terminalModel }));
vi.mock("~/models/Route", () => ({ Route: routeModel }));
vi.mock("~/lib/wsf/api", () => wsfApi);
vi.mock("~/lib/wsf/updateSchedules", () => wsfSchedules);
vi.mock("~/lib/forecast", () => ({ updateEstimates: vi.fn() }));

import {
  getCachedPublicSchedule,
  getPublicSchedule,
  getPublicSsrSchedule,
} from "../../server/services/public/schedules";
import {
  getPublicRoute,
  getPublicRoutesForTerminal,
  getPublicTerminal,
  getPublicTerminals,
} from "../../server/services/public/terminals";
import {
  getPublicVessel,
  getPublicVessels,
  getPublicVesselSnapshot,
} from "../../server/services/public/vessels";

describe("public query services", () => {
  it("uses the cached schedule serializer without starting a refresh", () => {
    const schedule = { date: "2026-06-21", slots: [] };
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-21");
    scheduleModel.getByIndex.mockReturnValue({ serialize: () => schedule });

    expect(
      getCachedPublicSchedule({
        arrivingId: "2",
        date: "2026-06-21",
        departingId: "1",
      })
    ).toMatchObject({
      schedule,
      status: "available",
      timestamp: expect.any(Number),
    });
  });

  it("keeps SSR schedule misses cache-only", async () => {
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-21");
    scheduleModel.getByIndex.mockReturnValue(null);

    await expect(
      getPublicSsrSchedule({
        arrivingId: "2",
        date: "2026-06-21",
        departingId: "1",
      })
    ).resolves.toEqual({ status: "warming" });
    expect(wsfSchedules.updateSchedules).not.toHaveBeenCalled();
  });

  it("returns persisted crossings for historical schedule lookups", async () => {
    scheduleModel.generateKey.mockReturnValue("1-2-2020-01-01");
    scheduleModel.getByIndex.mockReturnValue(null);
    vesselModel.getByIndex.mockReturnValue(null);
    crossingModel.findAll.mockResolvedValue([
      {
        arrivalId: "2",
        capacityReportUpdatedAt: 1577890000,
        departureDelta: null,
        departureId: "1",
        departureTime: 1577890800,
        driveUpCapacity: 42,
        hasDriveUp: true,
        hasReservations: false,
        isCancelled: false,
        reservableCapacity: 0,
        totalCapacity: 100,
        vesselId: null,
        vesselName: null,
        toJSON: () => ({
          id: 91,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T01:00:00.000Z",
        }),
      },
    ]);

    const result = await getPublicSchedule({
      arrivingId: "2",
      date: "2020-01-01",
      departingId: "1",
    });

    expect(result).toMatchObject({
      schedule: {
        slots: [
          {
            hasPassed: true,
            vessel: { name: "Unknown vessel", vehicleCapacity: 100 },
          },
        ],
      },
      status: "available",
    });
    if (result.status !== "available") {
      throw new Error("Expected historical schedule to be available");
    }
    expect(result.schedule.slots[0].crossing).toEqual({
      arrivalId: "2",
      capacityReportUpdatedAt: 1577890000,
      departureDelta: null,
      departureId: "1",
      departureTime: 1577890800,
      driveUpCapacity: 42,
      hasDriveUp: true,
      hasReservations: false,
      isCancelled: false,
      reservableCapacity: 0,
      totalCapacity: 100,
      vesselId: null,
      vesselName: null,
    });
    expect(result.schedule.slots[0].crossing).not.toHaveProperty("id");
    expect(result.schedule.slots[0].crossing).not.toHaveProperty("createdAt");
    expect(result.schedule.slots[0].crossing).not.toHaveProperty("updatedAt");
  });

  it("serializes public terminal, route, and vessel DTOs", async () => {
    const terminal = { id: "1", name: "Seattle" };
    const route = { id: "7", abbreviation: "SEA-BAIN" };
    const vessel = { id: "66", name: "Salish" };
    terminalModel.getAll.mockResolvedValue({
      "1": { serialize: () => terminal },
    });
    terminalModel.getByIndex.mockResolvedValue({ serialize: () => terminal });
    routeModel.getByIndex.mockReturnValue({ serialize: () => route });
    routeModel.getByTerminalId.mockReturnValue({
      "7": { serialize: () => route },
    });
    vesselModel.getAll.mockResolvedValue({
      "66": { serialize: () => vessel, statusUpdatedAt: 2_000_000_000_000 },
    });
    vesselModel.getByIndex.mockResolvedValue({ serialize: () => vessel });

    await expect(getPublicTerminals()).resolves.toEqual({ "1": terminal });
    await expect(getPublicTerminal("1")).resolves.toEqual({
      status: "available",
      terminal,
    });
    expect(getPublicRoute("7")).toEqual(route);
    expect(getPublicRoutesForTerminal("1")).toEqual({ "7": route });
    await expect(getPublicVessels()).resolves.toEqual({ "66": vessel });
    await expect(getPublicVesselSnapshot()).resolves.toEqual({
      sourceUpdatedAt: 2_000_000_000,
      vessels: { "66": vessel },
    });
    await expect(getPublicVessel("66")).resolves.toEqual({
      status: "available",
      vessel,
    });
  });

  it("distinguishes warming from a ready source that has no terminal or vessel", async () => {
    terminalModel.getByIndex.mockResolvedValue(null);
    vesselModel.getByIndex.mockResolvedValue(null);
    wsfApi.getWsfStatus.mockReturnValue({ coreReady: false });

    await expect(getPublicTerminal("missing")).resolves.toEqual({
      status: "warming",
    });
    await expect(getPublicVessel("missing")).resolves.toEqual({
      status: "warming",
    });

    wsfApi.getWsfStatus.mockReturnValue({ coreReady: true });
    await expect(getPublicTerminal("missing")).resolves.toEqual({
      status: "not-found",
    });
    await expect(getPublicVessel("missing")).resolves.toEqual({
      status: "not-found",
    });
  });
});
