import { describe, expect, it, vi } from "vitest";

import { exportGoogleRoutesUsage } from "../../server/lib/googleCloud/googleRoutesMonitoring";

describe("Google Routes usage export", () => {
  // report the number of snapshots actually written without provider or database I/O
  it("returns the dynamic exported series count", async () => {
    const snapshots = (
      [
        "autocomplete_requests",
        "compute_routes_essentials",
        "compute_routes_pro",
      ] as const
    ).map((sku) => ({
      attemptCount: 0,
      estimatedBillable: 0,
      knownFailureCount: 0,
      month: "2026-10",
      sku,
      successCount: 0,
      unresolvedCount: 0,
    }));
    const writer = { writeGoogleRoutesUsage: vi.fn(async () => undefined) };

    const result = await exportGoogleRoutesUsage({
      at: new Date("2026-10-03T01:00:00Z"),
      readUsage: async () => snapshots,
      writer,
    });

    expect(writer.writeGoogleRoutesUsage).toHaveBeenCalledWith(
      snapshots,
      new Date("2026-10-03T01:00:00Z")
    );
    expect(result).toEqual({ month: "2026-10", seriesCount: 3 });
  });
});
