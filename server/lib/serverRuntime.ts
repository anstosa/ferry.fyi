import { NextFunction, Request, Response, Router } from "express";

const DISABLED_ENV_PATTERN = /^(0|false|no|off)$/i;
const ENABLED_ENV_PATTERN = /^(1|true|yes|on)$/i;

export interface ReadinessController {
  check: () => Promise<boolean>;
  isDraining: () => boolean;
  isInitialized: () => boolean;
  markDraining: () => void;
  markInitialized: () => void;
}

export const createReadinessController = ({
  cacheMs = 5_000,
  now = Date.now,
  probe,
  timeoutMs = 1_500,
}: {
  cacheMs?: number;
  now?: () => number;
  probe: () => Promise<unknown>;
  timeoutMs?: number;
}): ReadinessController => {
  let draining = false;
  let initialized = false;
  let cached: { expiresAt: number; ready: boolean } | undefined;
  let pending: Promise<boolean> | undefined;

  const runProbe = async (): Promise<boolean> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        probe().then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
          timeout.unref();
        }),
      ]);
      return result;
    } catch {
      return false;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  return {
    async check() {
      if (!initialized || draining) {
        return false;
      }
      const current = now();
      if (cached && cached.expiresAt > current) {
        return cached.ready;
      }
      if (!pending) {
        pending = runProbe().then((ready) => {
          const currentReady = ready && initialized && !draining;
          cached = { expiresAt: now() + cacheMs, ready: currentReady };
          pending = undefined;
          return currentReady;
        });
      }
      return await pending;
    },
    isDraining: () => draining,
    isInitialized: () => initialized,
    markDraining() {
      draining = true;
      cached = undefined;
    },
    markInitialized() {
      initialized = true;
      cached = undefined;
    },
  };
};

export const createHealthRouter = (readiness: ReadinessController): Router => {
  const router = Router();
  router.get("/healthz", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(200).type("text/plain").send("ok");
  });
  router.get("/readyz", async (_request, response) => {
    const ready = await readiness.check();
    response.set("Cache-Control", "no-store");
    if (!ready) {
      response.set("Retry-After", "5");
    }
    response
      .status(ready ? 200 : 503)
      .type("text/plain")
      .send(ready ? "ready" : "not ready");
  });
  return router;
};

// Backward-compatible shallow health router for focused tests and small tools.
export const healthRouter = createHealthRouter(
  (() => {
    const readiness = createReadinessController({
      probe: () => Promise.resolve(true),
    });
    readiness.markInitialized();
    return readiness;
  })()
);

function readEnvFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (DISABLED_ENV_PATTERN.test(value)) {
    return false;
  }
  if (ENABLED_ENV_PATTERN.test(value)) {
    return true;
  }
  return undefined;
}

export function shouldRunScheduler(): boolean {
  const schedulerFlag = readEnvFlag(process.env.RUN_SCHEDULER);
  if (schedulerFlag !== undefined) {
    return schedulerFlag;
  }
  return true;
}

export function forceHttps(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const protocol = request.get("x-forwarded-proto") || request.protocol;
  if (protocol !== "https") {
    response.redirect(
      301,
      `https://${request.get("host")}${request.originalUrl}`
    );
    return;
  }
  next();
}
