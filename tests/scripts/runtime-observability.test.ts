import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseTelemetryJsonl,
  summarizeRuntimeObservability,
} from "../../scripts/summarize-runtime-observability.mjs";

const fixture = (name: string) =>
  path.resolve(__dirname, "../fixtures/observability", name);

describe("runtime observability summary", () => {
  it("summarizes route classes without hiding failures or invalid samples", () => {
    const parsed = parseTelemetryJsonl(
      fs.readFileSync(fixture("http-and-operations.jsonl"), "utf8")
    );
    const summary = summarizeRuntimeObservability({
      events: parsed.events,
      invalidSamples: parsed.invalidSamples,
      syntheticBundle: JSON.parse(
        fs.readFileSync(fixture("synthetics.json"), "utf8")
      ),
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.attainment).toBe(
      "not-assessed-requires-complete-production-window"
    );
    expect(summary.http.invalidSamples).toBe(1);
    expect(summary.http.routeClasses["ssr.public"]).toEqual({
      completedRequests: 3,
      failedRequests: 1,
      incompleteRequests: 1,
      latencyMs: { p50: 20, p95: 30, p99: 30 },
      rateLimitedRate: 0,
      serverErrorRate: 0.2,
      totalRequests: 5,
    });
    expect(summary.http.routeClasses["api.anonymous-read"]).toMatchObject({
      rateLimitedRate: 1,
      serverErrorRate: 0,
    });
  });

  it("reproduces availability, invalid source ages, and operation outcomes", () => {
    const parsed = parseTelemetryJsonl(
      fs.readFileSync(fixture("http-and-operations.jsonl"), "utf8")
    );
    const summary = summarizeRuntimeObservability({
      events: parsed.events,
      invalidSamples: parsed.invalidSamples,
      syntheticBundle: JSON.parse(
        fs.readFileSync(fixture("synthetics.json"), "utf8")
      ),
    });

    expect(summary.synthetics.canonical).toMatchObject({
      availability: 2 / 3,
      coverage: 1,
      reportable: true,
    });
    expect(summary.synthetics.readiness).toMatchObject({
      availability: 2 / 3,
      coverage: 1,
      reportable: true,
    });
    expect(summary.sourceAge.schedule).toEqual({
      invalidSamples: 2,
      outcomes: { future: 1, unavailable: 1, valid: 1 },
      validAgeMs: { p50: 60_000, p95: 60_000, p99: 60_000 },
      validSamples: 1,
    });
    expect(summary.operations["wsf-short-refresh"]).toEqual({
      overdue: 1,
      succeeded: 1,
    });
    expect(summary.hydration).toEqual({
      classification: "diagnostic",
      sli: false,
    });
  });
});
