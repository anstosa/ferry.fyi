import type { Server } from "node:http";

import type { Job } from "node-schedule";

import type { ReadinessController } from "./serverRuntime";

export const APPLICATION_DRAIN_TIMEOUT_MS = 25_000;

export class BackgroundRegistry {
  private readonly jobs = new Set<Pick<Job, "cancel">>();
  private readonly promises = new Set<Promise<unknown>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private stopping = false;

  canStart(): boolean {
    return !this.stopping;
  }

  trackJob<T extends Pick<Job, "cancel">>(job: T): T {
    if (this.stopping) {
      job.cancel();
    } else {
      this.jobs.add(job);
    }
    return job;
  }

  trackPromise<T>(promise: Promise<T>): Promise<T> {
    if (this.stopping) {
      promise.catch(() => undefined);
      return Promise.reject(new Error("server_draining"));
    }
    this.promises.add(promise);
    promise.finally(() => this.promises.delete(promise)).catch(() => undefined);
    return promise;
  }

  runTask<T>(task: () => Promise<T>): Promise<T> {
    if (this.stopping) {
      return Promise.reject(new Error("server_draining"));
    }
    return this.trackPromise(task());
  }

  trackTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
    if (this.stopping) {
      clearTimeout(timer);
    } else {
      this.timers.add(timer);
    }
    return timer;
  }

  async stop(deadlineAt: number): Promise<boolean> {
    this.stopping = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const job of this.jobs) {
      job.cancel();
    }
    this.jobs.clear();
    const remaining = Math.max(0, deadlineAt - Date.now());
    if (this.promises.size === 0) {
      return true;
    }
    return await Promise.race([
      Promise.allSettled([...this.promises]).then(() => true),
      new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), remaining);
        timeout.unref();
      }),
    ]);
  }
}

export interface ServerLifecycle {
  shutdown: (signal: NodeJS.Signals) => Promise<void>;
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });

const settleBefore = async (
  operation: () => Promise<unknown>,
  deadlineAt: number,
  now: () => number
): Promise<boolean> => {
  const remaining = Math.max(0, deadlineAt - now());
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation().then(
        () => true,
        () => false
      ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), remaining);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const createServerLifecycle = ({
  background,
  closeDatabase,
  closeDevelopmentServer,
  deadlineMs = APPLICATION_DRAIN_TIMEOUT_MS,
  exit,
  now = Date.now,
  readiness,
  restart,
  server,
  telemetry = () => undefined,
}: {
  background: BackgroundRegistry;
  closeDatabase: () => Promise<unknown>;
  closeDevelopmentServer?: () => Promise<unknown>;
  deadlineMs?: number;
  exit: (code: number) => void;
  now?: () => number;
  readiness: ReadinessController;
  restart: () => void;
  server: Server;
  telemetry?: (
    stage: "drain-completed" | "drain-forced" | "drain-started"
  ) => void;
}): ServerLifecycle => {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      readiness.markDraining();
      telemetry("drain-started");
      const deadlineAt = now() + deadlineMs;
      const httpClose = closeServer(server);
      const backgroundDrained = await background.stop(deadlineAt);
      const httpDrained = await settleBefore(() => httpClose, deadlineAt, now);
      let fullyDrained = httpDrained && backgroundDrained;
      if (closeDevelopmentServer) {
        fullyDrained =
          (await settleBefore(closeDevelopmentServer, deadlineAt, now)) &&
          fullyDrained;
      }
      fullyDrained =
        (await settleBefore(closeDatabase, deadlineAt, now)) && fullyDrained;
      if (fullyDrained) {
        telemetry("drain-completed");
      } else {
        telemetry("drain-forced");
        server.closeAllConnections?.();
      }
      if (signal === "SIGUSR2") {
        restart();
      } else {
        exit(0);
      }
    })();
    return shutdownPromise;
  };
  return { shutdown };
};

export const attachProcessSignalHandlers = (
  lifecycle: ServerLifecycle
): void => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGUSR2"] as const) {
    process.once(signal, () => {
      lifecycle.shutdown(signal).catch(() => process.exit(1));
    });
  }
};
