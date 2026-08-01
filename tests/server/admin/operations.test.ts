import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  updateDaily: vi.fn().mockResolvedValue(undefined),
  updateLong: vi.fn().mockResolvedValue(undefined),
  updateScheduleCache: vi.fn().mockResolvedValue(undefined),
  updateShort: vi.fn().mockResolvedValue(undefined),
  updateUserFacingStatus: vi.fn().mockResolvedValue(undefined),
  refreshCameraLineDetectionCache: vi.fn().mockResolvedValue(undefined),
  updateMajorSportsEvents: vi.fn().mockResolvedValue(undefined),
  updateSchoolBreakEvents: vi.fn().mockResolvedValue(undefined),
  warmDueFareCatalogs: vi.fn().mockResolvedValue(undefined),
  warmTodayFareCatalogs: vi.fn().mockResolvedValue(undefined),
  updateTideForecasts: vi.fn().mockResolvedValue(undefined),
  updateWeatherForecasts: vi.fn().mockResolvedValue(undefined),
}));
const cacheModels = vi.hoisted(() => ({
  Route: { purge: vi.fn() },
  Schedule: { purge: vi.fn() },
}));
const rows = vi.hoisted(() => new Map<string, any>());
const status = vi.hoisted(() => ({
  findByPk: vi.fn(),
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
  update: vi.fn(),
}));
const db = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("~/lib/cameraLineDetection", () => ({
  refreshCameraLineDetectionCache: operations.refreshCameraLineDetectionCache,
}));
vi.mock("~/lib/demandEvents/updateMajorSportsEvents", () => ({
  updateMajorSportsEvents: operations.updateMajorSportsEvents,
}));
vi.mock("~/lib/demandEvents/updateSchoolBreakEvents", () => ({
  updateSchoolBreakEvents: operations.updateSchoolBreakEvents,
}));
vi.mock("~/lib/fareCache", () => ({
  warmDueFareCatalogs: operations.warmDueFareCatalogs,
  warmTodayFareCatalogs: operations.warmTodayFareCatalogs,
}));
vi.mock("~/lib/tides/updateForecasts", () => ({
  updateTideForecasts: operations.updateTideForecasts,
}));
vi.mock("~/lib/weather/updateForecasts", () => ({
  updateWeatherForecasts: operations.updateWeatherForecasts,
}));
vi.mock("~/lib/wsf", () => ({
  updateDaily: operations.updateDaily,
  updateLong: operations.updateLong,
  updateScheduleCache: operations.updateScheduleCache,
  updateShort: operations.updateShort,
  updateUserFacingStatus: operations.updateUserFacingStatus,
}));
vi.mock("~/models/Route", () => ({ Route: cacheModels.Route }));
vi.mock("~/models/Schedule", () => ({ Schedule: cacheModels.Schedule }));
vi.mock("~/models/AdminOperationStatus", () => ({
  AdminOperationStatus: status,
}));
vi.mock("~/lib/db", () => ({ db }));

import {
  ADMIN_OPERATION_LEASE_MS,
  ADMIN_OPERATION_LEASE_RENEWAL_MS,
  getAdminOperationStates,
  runAdminOperation,
} from "../../../server/lib/admin/operations";

const makeRow = (operation: string, state: Record<string, unknown> = {}) => {
  const row: any = {
    endedAt: null,
    error: null,
    leaseExpiresAt: null,
    leaseToken: null,
    operation,
    result: null,
    startedAt: null,
    status: "idle",
    ...state,
    update: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(row, next);
      return row;
    }),
  };
  rows.set(operation, row);
  return row;
};

describe("admin operation leases", () => {
  beforeEach(() => {
    rows.clear();
    vi.clearAllMocks();
    db.transaction.mockImplementation(async (callback: any) =>
      callback({ LOCK: { UPDATE: "UPDATE" } })
    );
    status.findOrCreate.mockImplementation(async ({ where, defaults }: any) => {
      const row =
        rows.get(where.operation) ?? makeRow(where.operation, defaults);
      return [row, false];
    });
    status.findOne.mockImplementation(async ({ where }: any) =>
      rows.get(where.operation)
    );
    status.findByPk.mockImplementation(async (operation: string) =>
      rows.get(operation)
    );
    status.update.mockImplementation(
      async (next: Record<string, unknown>, { where }: any) => {
        const row = rows.get(where.operation);
        if (
          row &&
          row.status === where.status &&
          row.leaseToken === where.leaseToken
        ) {
          Object.assign(row, next);
          return [1];
        }
        return [0];
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews a pending lease so another process cannot acquire after its initial TTL", async () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    vi.useFakeTimers({ now });
    let completeOperation: (() => void) | undefined;
    operations.updateUserFacingStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeOperation = resolve;
        })
    );

    const firstRun = runAdminOperation("wsf-short-refresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(operations.updateUserFacingStatus).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(ADMIN_OPERATION_LEASE_MS + 1);
    const secondRun = await runAdminOperation("wsf-short-refresh");

    expect(secondRun.started).toBe(false);
    expect(status.update).toHaveBeenCalledWith(
      expect.objectContaining({ leaseExpiresAt: expect.any(Date) }),
      expect.objectContaining({
        where: expect.objectContaining({ status: "running" }),
      })
    );
    expect(operations.updateUserFacingStatus).toHaveBeenCalledOnce();

    completeOperation?.();
    await firstRun;
    expect(ADMIN_OPERATION_LEASE_RENEWAL_MS).toBeLessThan(
      ADMIN_OPERATION_LEASE_MS
    );
  });

  it("serializes an active operation with a database row lease", async () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    makeRow("wsf-refresh", {
      leaseExpiresAt: new Date(now.getTime() + ADMIN_OPERATION_LEASE_MS),
      leaseToken: "other-process",
      startedAt: now,
      status: "running",
    });

    const result = await runAdminOperation("wsf-short-refresh", now);

    expect(result.started).toBe(false);
    expect(operations.updateUserFacingStatus).not.toHaveBeenCalled();
    expect(status.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: "UPDATE" })
    );
  });

  it("shares the WSF lease between a manual refresh and scheduled notifying work", async () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    makeRow("wsf-refresh", {
      leaseExpiresAt: new Date(now.getTime() + ADMIN_OPERATION_LEASE_MS),
      leaseToken: "manual-owner",
      startedAt: now,
      status: "running",
    });

    const result = await runAdminOperation("wsf-short-notifying-refresh", now);

    expect(result.started).toBe(false);
    expect(result.operation.operation).toBe("wsf-refresh");
    expect(operations.updateShort).not.toHaveBeenCalled();
  });

  it("recovers a stale lease and executes the named WSF no-notification path", async () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    const row = makeRow("wsf-refresh", {
      leaseExpiresAt: new Date(now.getTime() - 1),
      leaseToken: "dead-process",
      startedAt: new Date(now.getTime() - ADMIN_OPERATION_LEASE_MS),
      status: "running",
    });

    const result = await runAdminOperation("wsf-refresh", now);

    expect(result.started).toBe(true);
    expect(result.operation.status).toBe("succeeded");
    expect(row.leaseToken).toBeNull();
    expect(operations.updateLong).toHaveBeenCalledTimes(1);
    expect(operations.updateUserFacingStatus).toHaveBeenCalledTimes(1);
    expect(operations.updateScheduleCache).toHaveBeenCalledTimes(1);
  });

  it("preserves the route catalog while clearing the schedule cache", async () => {
    const result = await runAdminOperation("clear-wsf-memory-cache");

    expect(result.operation.status).toBe("succeeded");
    expect(cacheModels.Schedule.purge).toHaveBeenCalledOnce();
    expect(cacheModels.Route.purge).not.toHaveBeenCalled();
    expect(operations.updateLong).not.toHaveBeenCalled();
  });

  it("describes each operation and reports the shared WSF run time", async () => {
    const completedAt = new Date("2026-07-25T00:15:00.000Z");
    makeRow("wsf-refresh", {
      endedAt: completedAt,
      status: "succeeded",
    });

    const states = await getAdminOperationStates();
    const shortRefresh = states.find(
      ({ operation }) => operation === "wsf-short-refresh"
    );
    const fareRefresh = states.find(
      ({ operation }) => operation === "fare-catalog-refresh"
    );

    expect(shortRefresh).toMatchObject({
      canRun: true,
      description: expect.stringContaining("vessel status"),
      lastRunAt: completedAt.toISOString(),
      trigger: expect.stringContaining("Every minute"),
    });
    expect(fareRefresh).toMatchObject({
      canRun: true,
      description: expect.stringContaining("fare"),
      lastRunAt: null,
      trigger: expect.stringContaining("Hourly"),
    });
  });
});
