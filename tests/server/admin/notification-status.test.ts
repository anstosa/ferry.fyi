import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  channel: string;
  expiresAt: Date | null;
  inFlightCount: number;
  queuedCount: number;
  requestResult: "accepted" | "failed" | "paused" | "unavailable" | null;
  update: ReturnType<typeof vi.fn>;
};

const database = vi.hoisted(() => ({
  row: undefined as RuntimeRow | undefined,
  transaction: vi.fn(),
}));

const statusModel = vi.hoisted(() => ({
  findByPk: vi.fn(),
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ db: { transaction: database.transaction } }));
vi.mock("~/models/NotificationRuntimeStatus", () => ({
  NotificationRuntimeStatus: statusModel,
}));
vi.mock("~/lib/admin/notificationPolicy", () => ({
  getNotificationPolicy: vi.fn().mockResolvedValue({ paused: false }),
}));

const makeRow = (): RuntimeRow => {
  const row: RuntimeRow = {
    channel: "push",
    expiresAt: null,
    inFlightCount: 0,
    queuedCount: 0,
    requestResult: null,
    update: vi.fn(),
  };
  row.update.mockImplementation(async (values: Partial<RuntimeRow>) => {
    Object.assign(row, values);
    return row;
  });
  return row;
};

describe("persisted notification runtime aggregates", () => {
  beforeEach(() => {
    vi.resetModules();
    database.row = undefined;
    database.transaction.mockReset().mockImplementation(async (callback) =>
      callback({ LOCK: { UPDATE: "UPDATE" } })
    );
    statusModel.findOrCreate.mockReset().mockImplementation(async ({ defaults }) => {
      const created = database.row === undefined;
      if (created) {
        database.row = makeRow();
        Object.assign(database.row, defaults);
      }
      return [database.row, created];
    });
    statusModel.findOne.mockReset().mockImplementation(async () => database.row);
    statusModel.findByPk.mockReset().mockImplementation(async () => database.row);
  });

  it("shares one overwritten aggregate across independently loaded service instances", async () => {
    const first = await import("../../../server/lib/admin/notificationStatus");
    await first.notificationQueued();
    await expect(first.getNotificationDashboard()).resolves.toMatchObject({
      channels: { push: { queueState: "active", queued: 1 } },
    });
    await first.notificationDequeued();

    vi.resetModules();
    const second = await import("../../../server/lib/admin/notificationStatus");
    await second.notificationFinished("accepted");
    await expect(second.getNotificationDashboard()).resolves.toMatchObject({
      channels: {
        push: {
          inFlight: 0,
          queueState: "not-queued",
          queued: 0,
          requestResult: "accepted",
        },
      },
      requestResult: "accepted",
    });
    expect(statusModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: "UPDATE", where: { channel: "push" } })
    );
  });

  it("expires stale counters and results instead of retaining a delivery history", async () => {
    const status = await import("../../../server/lib/admin/notificationStatus");
    database.row = makeRow();
    database.row.queuedCount = 7;
    database.row.inFlightCount = 2;
    database.row.requestResult = "failed";
    database.row.expiresAt = new Date(Date.now() - 1);

    await expect(status.getNotificationDashboard()).resolves.toMatchObject({
      channels: {
        push: {
          inFlight: 0,
          queueState: "not-queued",
          queued: 0,
          requestResult: null,
        },
      },
    });
    expect(database.row).toMatchObject({
      inFlightCount: 0,
      queuedCount: 0,
      requestResult: null,
      expiresAt: null,
    });
  });
});
