import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  classifyHttpRoute,
  createHttpTelemetryMiddleware,
  type HttpTelemetryEvent,
  validateHttpTelemetryEvent,
} from "../../server/lib/httpTelemetry";

describe("public HTTP telemetry", () => {
  it("emits one category-only event without request values", async () => {
    const sink = vi.fn<(event: HttpTelemetryEvent) => void>();
    const app = express();
    app.use(
      createHttpTelemetryMiddleware({
        now: (() => {
          const values = [0n, 12_345_000n];
          return () => values.shift() ?? 12_345_000n;
        })(),
        release: "v123",
        sink,
      })
    );
    app.get("/api/tickets/:ticket", (_request, response) =>
      response.status(500).send({ error: "nope" })
    );

    await request(app)
      .get("/api/tickets/secret-ticket?token=secret-token")
      .set("authorization", "Bearer secret")
      .expect(500);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      completionOutcome: "failed",
      durationMs: 12.345,
      event: "public_http_request",
      methodClass: "read",
      release: "v123",
      routeClass: "api.sensitive-lookup",
      schemaVersion: 1,
      statusClass: "5xx",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /secret|authorization|token/i
    );
  });

  it("normalizes discovery, readiness, API, SSR, and asset routes", () => {
    const classify = (method: string, originalUrl: string) =>
      classifyHttpRoute({ method, originalUrl, path: originalUrl });
    expect(classify("GET", "/readyz")).toBe("readiness");
    expect(classify("GET", "/openapi.json")).toBe("discovery");
    expect(classify("GET", "/api/features")).toBe("api.anonymous-read");
    expect(classify("POST", "/api/leaderboards/native/candidates")).toBe(
      "api.automatic-native"
    );
    expect(classify("POST", "/api/admin/jobs")).toBe("api.authenticated");
    expect(classify("POST", "/api/ads/measure")).toBe("api.ad-measurement");
    expect(classify("GET", "/seattle/bainbridge?date=private")).toBe(
      "ssr.public"
    );
    expect(classify("GET", "/assets/main.abc123.js")).toBe("asset");
  });

  // prove native telemetry never derives fields from sensitive request data
  it("emits only the fixed automatic native route class", async () => {
    const sink = vi.fn<(event: HttpTelemetryEvent) => void>();
    const app = express();
    app.use(createHttpTelemetryMiddleware({ release: "v124", sink }));
    // emit one fixed test response
    app.post("/api/leaderboards/native/candidates", (_request, response) =>
      response.status(429).json({ limited: true })
    );

    await request(app)
      .post("/api/leaderboards/native/candidates?candidateId=private-candidate")
      .set("Authorization", "Bearer private-token")
      .set("X-Enrollment-Digest", "private-enrollment")
      .send({ latitudeE7: 473000000, limiterKey: "private-limiter" })
      .expect(429);

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        routeClass: "api.automatic-native",
        statusClass: "429",
      })
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /private|candidateId|authorization|enrollment|latitude|limiter/i
    );
  });

  it("rejects fields outside the privacy boundary", () => {
    expect(() =>
      validateHttpTelemetryEvent({
        authorization: "secret",
        completionOutcome: "completed",
        durationMs: 1,
        event: "public_http_request",
        methodClass: "read",
        release: "unknown",
        routeClass: "ssr.public",
        schemaVersion: 1,
        statusClass: "2xx",
      })
    ).toThrow(/not allowed/);
  });
});
