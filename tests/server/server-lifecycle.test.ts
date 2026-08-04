import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  BackgroundRegistry,
  createServerLifecycle,
} from "../../server/lib/serverLifecycle";
import { createReadinessController } from "../../server/lib/serverRuntime";

const ready = () => {
  const controller = createReadinessController({ probe: async () => true });
  controller.markInitialized();
  return controller;
};

describe("server lifecycle", () => {
  it("stops timers/jobs and waits for tracked background work", async () => {
    const registry = new BackgroundRegistry();
    const cancel = vi.fn();
    registry.trackJob({ cancel });
    const timer = setTimeout(() => undefined, 60_000);
    registry.trackTimer(timer);
    let finish = () => undefined;
    registry.trackPromise(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );

    const stopping = registry.stop(Date.now() + 1_000);
    finish();

    await expect(stopping).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(registry.canStart()).toBe(false);
  });

  it("does not start new background tasks after draining begins", async () => {
    const registry = new BackgroundRegistry();
    const task = vi.fn(() => Promise.resolve("started"));

    await registry.stop(Date.now() + 1_000);

    await expect(registry.runTask(task)).rejects.toThrow("server_draining");
    expect(task).not.toHaveBeenCalled();
  });

  it("marks unready first and preserves shutdown ordering", async () => {
    const events: string[] = [];
    const readiness = ready();
    const originalMarkDraining = readiness.markDraining;
    readiness.markDraining = () => {
      events.push("draining");
      originalMarkDraining();
    };
    const server = {
      close: (callback: () => void) => {
        events.push("server-close");
        callback();
        return server;
      },
      closeAllConnections: vi.fn(),
      closeIdleConnections: () => events.push("idle-close"),
    } as unknown as Server;
    const exit = vi.fn();
    const telemetry = vi.fn();
    const lifecycle = createServerLifecycle({
      background: new BackgroundRegistry(),
      closeDatabase: async () => {
        events.push("db-close");
      },
      closeDevelopmentServer: async () => {
        events.push("vite-close");
      },
      exit,
      readiness,
      restart: vi.fn(),
      server,
      telemetry,
    });

    const first = lifecycle.shutdown("SIGTERM");
    const second = lifecycle.shutdown("SIGINT");
    expect(first).toBe(second);
    await first;

    expect(events).toEqual([
      "draining",
      "server-close",
      "idle-close",
      "vite-close",
      "db-close",
    ]);
    expect(exit).toHaveBeenCalledOnce();
    expect(telemetry.mock.calls).toEqual([
      ["drain-started"],
      ["drain-completed"],
    ]);
    await expect(readiness.check()).resolves.toBe(false);
  });

  it("force-closes connections after the deadline and restarts once", async () => {
    const closeAllConnections = vi.fn();
    const server = {
      close: () => server,
      closeAllConnections,
      closeIdleConnections: vi.fn(),
    } as unknown as Server;
    const restart = vi.fn();
    const telemetry = vi.fn();
    const lifecycle = createServerLifecycle({
      background: new BackgroundRegistry(),
      closeDatabase: async () => undefined,
      deadlineMs: 5,
      exit: vi.fn(),
      readiness: ready(),
      restart,
      server,
      telemetry,
    });

    await lifecycle.shutdown("SIGUSR2");

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
    expect(telemetry.mock.calls).toEqual([["drain-started"], ["drain-forced"]]);
  });

  it("bounds development and database cleanup by the global deadline", async () => {
    const closeAllConnections = vi.fn();
    const closeDatabase = vi.fn(() => Promise.resolve());
    const server = {
      close: (callback: () => void) => {
        callback();
        return server;
      },
      closeAllConnections,
      closeIdleConnections: vi.fn(),
    } as unknown as Server;
    const exit = vi.fn();
    const lifecycle = createServerLifecycle({
      background: new BackgroundRegistry(),
      closeDatabase,
      closeDevelopmentServer: () => new Promise(() => undefined),
      deadlineMs: 5,
      exit,
      readiness: ready(),
      restart: vi.fn(),
      server,
    });

    await lifecycle.shutdown("SIGTERM");

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
