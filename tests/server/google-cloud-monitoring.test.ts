import { describe, expect, it, vi } from "vitest";

import {
  createGoogleMonitoringWriter,
  GOOGLE_ROUTES_USAGE_METRIC,
} from "../../server/lib/googleCloud/monitoring";

describe("Google Routes Monitoring exporter", () => {
  // a stalled monitoring write must not block subsequent leased exports
  it("aborts a stalled monitoring request", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // emulate only the external network cancellation boundary
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        })
    );
    try {
      const writer = createGoogleMonitoringWriter({
        fetchImpl: fetchImpl as typeof fetch,
        getAccessToken: async () => "token",
        projectId: "ferry-monitoring-prod",
      });
      const outcome = expect(
        writer.writeGoogleRoutesUsage([], new Date())
      ).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(10_000);
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // send all three origin-free sku gauges without a month label
  it("writes route and autocomplete estimated request series", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const writer = createGoogleMonitoringWriter({
      fetchImpl: fetchImpl as typeof fetch,
      getAccessToken: async () => "short-lived-token",
      projectId: "ferry-monitoring-prod",
    });

    await writer.writeGoogleRoutesUsage(
      [
        {
          attemptCount: 2,
          estimatedBillable: 2,
          knownFailureCount: 0,
          month: "2026-10",
          sku: "autocomplete_requests",
          successCount: 1,
          unresolvedCount: 1,
        },
        {
          attemptCount: 8,
          estimatedBillable: 8,
          knownFailureCount: 1,
          month: "2026-10",
          sku: "compute_routes_essentials",
          successCount: 7,
          unresolvedCount: 0,
        },
        {
          attemptCount: 3,
          estimatedBillable: 3,
          knownFailureCount: 0,
          month: "2026-10",
          sku: "compute_routes_pro",
          successCount: 2,
          unresolvedCount: 1,
        },
      ],
      new Date("2026-10-03T01:00:00Z")
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://monitoring.googleapis.com/v3/projects/ferry-monitoring-prod/timeSeries"
    );
    const options = fetchImpl.mock.calls[0][1];
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer short-lived-token",
    });
    const payload = JSON.parse(String(options?.body));
    expect(payload.timeSeries).toHaveLength(3);
    expect(payload.timeSeries[0]).toMatchObject({
      metric: {
        labels: { sku: "autocomplete_requests" },
        type: GOOGLE_ROUTES_USAGE_METRIC,
      },
      points: [{ value: { int64Value: "2" } }],
    });
    expect(payload.timeSeries[1]).toMatchObject({
      metric: {
        labels: { sku: "compute_routes_essentials" },
        type: GOOGLE_ROUTES_USAGE_METRIC,
      },
      points: [{ value: { int64Value: "8" } }],
      resource: {
        labels: { project_id: "ferry-monitoring-prod" },
        type: "global",
      },
    });
    expect(payload.timeSeries[0].metric.labels).not.toHaveProperty("month");
  });

  // reject a dynamic or malformed project path
  it("validates the project ID before creating a writer", () => {
    expect(() =>
      createGoogleMonitoringWriter({
        getAccessToken: async () => "token",
        projectId: "../arbitrary/path",
      })
    ).toThrow("Invalid Google Cloud project ID");
  });
});
