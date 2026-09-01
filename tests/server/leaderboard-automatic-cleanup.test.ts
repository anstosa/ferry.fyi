import { describe, expect, it, vi } from "vitest";

// provide import-time server configuration
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://test:testing@localhost:5432/ferryfyi";
});

// hoist cleanup telemetry and scheduling seams
const { info, scheduleJob } = vi.hoisted(() => ({
  info: vi.fn(),
  // return one cancellable scheduled job
  scheduleJob: vi.fn(() => ({ cancel: vi.fn() })),
}));

// bind cleanup telemetry
vi.mock("~/lib/logger", () => ({
  default: {
    error: vi.fn(),
    info,
    warn: vi.fn(),
  },
}));

// bind the scheduler seam
vi.mock("node-schedule", async () => {
  const actual =
    await vi.importActual<typeof import("node-schedule")>("node-schedule");
  return { ...actual, scheduleJob };
});

// bypass unrelated server routers
vi.mock("~/controllers/api", () => ({
  // bypass ordinary api routing
  apiRouter: (_request: unknown, _response: unknown, next: () => void) =>
    next(),
  // bypass isolated native routing
  automaticLeaderboardNativeRouter: (
    _request: unknown,
    _response: unknown,
    next: () => void
  ) => next(),
}));

import {
  runAutomaticLeaderboardCleanup,
  scheduleAutomaticLeaderboardCleanup,
} from "../../server/server";

// verify production cleanup lifecycle composition
describe("automatic leaderboard cleanup lifecycle", () => {
  // prove the durable dependency order
  it("prunes receipts before enrollments and configs", async () => {
    const order: string[] = [];

    const result = await runAutomaticLeaderboardCleanup({
      // observe config cleanup
      cleanupConfigs: () => {
        order.push("configs");
        return Promise.resolve(3);
      },
      // observe enrollment cleanup
      cleanupEnrollments: () => {
        order.push("enrollments");
        return Promise.resolve(2);
      },
      // observe receipt cleanup
      cleanupReceipts: () => {
        order.push("receipts");
        return Promise.resolve(1);
      },
    });

    expect(order).toEqual(["receipts", "enrollments", "configs"]);
    expect(result).toEqual({
      configs: { count: 3, outcome: "completed" },
      enrollments: { count: 2, outcome: "completed" },
      receipts: { count: 1, outcome: "completed" },
    });
    expect(info).toHaveBeenCalledWith("Automatic leaderboard cleanup", {
      configCount: 3,
      configOutcome: "completed",
      enrollmentCount: 2,
      enrollmentOutcome: "completed",
      receiptCount: 1,
      receiptOutcome: "completed",
    });
  });

  // prove one failed dependency never aborts safe later checks
  it("isolates failures into fixed telemetry and continues", async () => {
    const privateError = "private cleanup database canary";
    // observe enrollment continuation
    const cleanupEnrollments = vi.fn(() => Promise.resolve(2));
    // observe config continuation
    const cleanupConfigs = vi.fn(() => Promise.resolve(3));

    const result = await runAutomaticLeaderboardCleanup({
      cleanupConfigs,
      cleanupEnrollments,
      // fail one receipt prune
      cleanupReceipts: () => Promise.reject(new Error(privateError)),
    });

    expect(result.receipts).toEqual({ count: 0, outcome: "failed" });
    expect(cleanupEnrollments).toHaveBeenCalledOnce();
    expect(cleanupConfigs).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls)).not.toContain(privateError);
  });

  // prove the production daily caller exists
  it("schedules one daily dependency-safe cleanup", () => {
    scheduleAutomaticLeaderboardCleanup();

    expect(scheduleJob).toHaveBeenCalledWith(
      { hour: 3, minute: 30, second: 0 },
      expect.any(Function)
    );
  });
});
