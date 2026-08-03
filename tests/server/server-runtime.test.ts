import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
