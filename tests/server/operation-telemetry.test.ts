import { describe, expect, it } from "vitest";

import { operationStateToTelemetry } from "../../server/lib/operationTelemetry";

describe("scheduled operation telemetry", () => {
  it("projects persisted state without error or result details", () => {
    const event = operationStateToTelemetry(
      {
        canRun: true,
        description: "secret description",
        endedAt: "2026-08-03T23:58:00.000Z",
        error: "database details",
        lastRunAt: "2026-08-03T23:58:00.000Z",
        leaseExpiresAt: null,
        operation: "wsf-short-refresh",
        result: "private result",
        startedAt: "2026-08-03T23:57:30.000Z",
        status: "succeeded",
        trigger: "every minute",
      },
      "2026-08-04T00:00:00.000Z"
    );

    expect(event).toMatchObject({
      cadenceMs: 60_000,
      event: "scheduled_operation",
      lagMs: 120_000,
      operation: "wsf-short-refresh",
      outcome: "overdue",
      schemaVersion: 1,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /database details|private result|secret description/
    );
  });

  it("retains the logical scheduled job when several jobs share one lease", () => {
    const event = operationStateToTelemetry(
      {
        canRun: true,
        description: "shared lease",
        endedAt: "2026-08-03T23:59:30.000Z",
        error: null,
        lastRunAt: "2026-08-03T23:59:30.000Z",
        leaseExpiresAt: null,
        operation: "wsf-refresh",
        result: "Completed",
        startedAt: "2026-08-03T23:59:00.000Z",
        status: "succeeded",
        trigger: "startup",
      },
      "2026-08-04T00:00:00.000Z",
      "wsf-short-refresh"
    );

    expect(event).toMatchObject({
      cadenceMs: 60_000,
      operation: "wsf-short-refresh",
      outcome: "succeeded",
    });
  });
});
