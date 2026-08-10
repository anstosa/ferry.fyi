import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyApiRequest,
  createApiRateLimitMiddleware,
} from "../../server/lib/httpApiPolicy";

afterEach(() => vi.unstubAllEnvs());

describe("API rate policy", () => {
  it("rate-limits destructive account deletion as a sensitive action", () => {
    expect(
      classifyApiRequest({ method: "DELETE", pathname: "/api/user" })
    ).toBe("sensitive-lookup");
    expect(classifyApiRequest({ method: "GET", pathname: "/api/user" })).toBe(
      "authenticated"
    );
  });

  it("emits standard limit headers and separates route-class counters", async () => {
    vi.stubEnv("API_ANONYMOUS_READ_LIMIT", "1");
    vi.stubEnv("API_SENSITIVE_LOOKUP_LIMIT", "1");
    vi.stubEnv("API_UPSTREAM_REFRESH_LIMIT", "1");
    const app = express();
    app.use(createApiRateLimitMiddleware());
    app.all("*path", (_request, response) => response.json({ ok: true }));

    const publicRead = await request(app).get("/api/features").expect(200);
    expect(publicRead.headers.ratelimit).toBeTruthy();

    const publicLimited = await request(app).get("/api/features").expect(429);
    expect(publicLimited.headers.ratelimit).toBeTruthy();
    expect(publicLimited.headers["retry-after"]).toBeTruthy();
    expect(publicLimited.body.body).toEqual({ error: "rate_limited" });
    expect(publicLimited.headers["cache-control"]).toBe("no-store");

    await request(app).get("/api/tickets/example").expect(200);
    await request(app).post("/api/vessels/refresh").expect(200);
  });
});
