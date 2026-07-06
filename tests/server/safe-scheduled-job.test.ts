import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: logger,
}));

const {
  isTransientDatabaseError,
  runScheduledTask,
  safeScheduledTask,
} = await import("../../server/lib/safeScheduledJob");

// scheduled job protection
describe("safe scheduled jobs", () => {
  // reset logger mock
  beforeEach(() => {
    logger.error.mockClear();
  });

  // db error classification
  it("recognizes transient sequelize connection failures", () => {
    const error = Object.assign(new Error("Connection terminated unexpectedly"), {
      name: "SequelizeConnectionError",
      parent: new Error("Connection terminated unexpectedly"),
    });

    expect(isTransientDatabaseError(error)).toBe(true);
  });

  // rejected task behavior
  it("logs rejected scheduled tasks instead of rethrowing", async () => {
    const error = Object.assign(new Error("Connection terminated unexpectedly"), {
      name: "SequelizeConnectionError",
    });

    await expect(
      runScheduledTask("short WSF refresh", async () => {
        throw error;
      })
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Transient database error"),
      error
    );
  });

  // callback behavior
  it("returns a node-schedule-safe void callback", async () => {
    const task = vi.fn().mockRejectedValue(new Error("boom"));
    const callback = safeScheduledTask("test job", task);

    expect(callback()).toBeUndefined();
    await new Promise((resolve) => {
      // flush scheduled promise
      setTimeout(resolve, 0);
    });

    expect(task).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Scheduled job failed test job"),
      expect.any(Error)
    );
  });
});
