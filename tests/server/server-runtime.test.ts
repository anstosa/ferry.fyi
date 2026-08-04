import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHealthRouter,
  createReadinessController,
  forceHttps,
  healthRouter,
  shouldRunScheduler,
} from "../../server/lib/serverRuntime";

// create health-first app
function createRedirectingApp(): express.Express {
  const app = express();
  app.use(healthRouter);
  app.use(forceHttps);
  // protected route
  app.get("/secure", (_request, response) => {
    response.send("secure");
  });
  return app;
}

describe("server runtime health checks", () => {
  // health redirect bypass
  it("serves /healthz before HTTPS redirects", async () => {
    const app = createRedirectingApp();

    const response = await request(app)
      .get("/healthz")
      .set("x-forwarded-proto", "http")
      .expect(200);

    expect(response.text).toBe("ok");
  });

  // redirect sanity check
  it("still redirects non-health HTTP traffic", async () => {
    const app = createRedirectingApp();

    await request(app)
      .get("/secure")
      .set("host", "staging.ferry.fyi")
      .set("x-forwarded-proto", "http")
      .expect("location", "https://staging.ferry.fyi/secure")
      .expect(301);
  });

  it("keeps readiness false until initialization and hides dependency detail", async () => {
    const readiness = createReadinessController({
      probe: async () => {
        throw new Error("database hostname secret");
      },
    });
    const app = express();
    app.use(createHealthRouter(readiness));

    const before = await request(app).get("/readyz").expect(503);
    expect(before.text).toBe("not ready");
    expect(before.text).not.toContain("database");
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.headers["retry-after"]).toBe("5");

    readiness.markInitialized();
    const failed = await request(app).get("/readyz").expect(503);
    expect(failed.text).toBe("not ready");
  });

  it("caches bounded probes and becomes unready while draining", async () => {
    let now = 1_000;
    const probe = vi.fn().mockResolvedValue(undefined);
    const readiness = createReadinessController({
      cacheMs: 100,
      now: () => now,
      probe,
    });
    readiness.markInitialized();

    await expect(readiness.check()).resolves.toBe(true);
    await expect(readiness.check()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledOnce();

    now += 101;
    await expect(readiness.check()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);

    readiness.markDraining();
    await expect(readiness.check()).resolves.toBe(false);
  });

  it("does not report a pending probe as ready after draining starts", async () => {
    let resolveProbe = () => undefined;
    const readiness = createReadinessController({
      probe: () =>
        new Promise<void>((resolve) => {
          resolveProbe = resolve;
        }),
    });
    readiness.markInitialized();

    const pending = readiness.check();
    readiness.markDraining();
    resolveProbe();

    await expect(pending).resolves.toBe(false);
  });
});

describe("server runtime scheduler ownership", () => {
  // restore env mutations
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // default compatibility case
  it("runs schedulers by default", () => {
    expect(shouldRunScheduler()).toBe(true);
  });

  // combined production owner case
  it("runs schedulers for the web process role by default", () => {
    vi.stubEnv("PROCESS_ROLE", "web");

    expect(shouldRunScheduler()).toBe(true);
  });

  // scheduler role case
  it("runs schedulers for scheduler process role", () => {
    vi.stubEnv("PROCESS_ROLE", "scheduler");

    expect(shouldRunScheduler()).toBe(true);
  });

  // explicit flag case
  it("lets RUN_SCHEDULER override the process role", () => {
    vi.stubEnv("PROCESS_ROLE", "web");
    vi.stubEnv("RUN_SCHEDULER", "true");

    expect(shouldRunScheduler()).toBe(true);
  });

  // explicit disable case
  it("disables schedulers when RUN_SCHEDULER is false", () => {
    vi.stubEnv("RUN_SCHEDULER", "false");

    expect(shouldRunScheduler()).toBe(false);
  });
});
