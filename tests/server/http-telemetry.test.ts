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
    expect(classify("POST", "/api/admin/jobs")).toBe("api.authenticated");
    expect(classify("GET", "/seattle/bainbridge?date=private")).toBe(
      "ssr.public"
    );
    expect(classify("GET", "/assets/main.abc123.js")).toBe("asset");
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
