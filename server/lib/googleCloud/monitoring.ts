import type { GoogleRoutesUsageSnapshot } from "~/lib/googleRoutesUsage";

import { withGoogleCloudRequestTimeout } from "./requestTimeout";

export const GOOGLE_ROUTES_USAGE_METRIC =
  "custom.googleapis.com/ferry_fyi/google_routes/month_to_date_estimated_requests";

export interface GoogleMonitoringWriter {
  writeGoogleRoutesUsage(
    snapshots: GoogleRoutesUsageSnapshot[],
    at: Date
  ): Promise<void>;
}

/** Creates the privacy-bounded Cloud Monitoring REST writer. */
export function createGoogleMonitoringWriter(dependencies: {
  fetchImpl?: typeof fetch;
  getAccessToken(): Promise<string>;
  projectId: string;
}): GoogleMonitoringWriter {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  // reject project IDs before using them in the fixed API host path
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(dependencies.projectId)) {
    throw new Error("Invalid Google Cloud project ID");
  }

  return {
    // export only month-independent sku gauges and counts
    async writeGoogleRoutesUsage(snapshots, at) {
      const accessToken = await dependencies.getAccessToken();
      const timeSeries = snapshots.map((snapshot) => ({
        metric: {
          labels: { sku: snapshot.sku },
          type: GOOGLE_ROUTES_USAGE_METRIC,
        },
        points: [
          {
            interval: { endTime: at.toISOString() },
            value: { int64Value: String(snapshot.estimatedBillable) },
          },
        ],
        resource: {
          labels: { project_id: dependencies.projectId },
          type: "global",
        },
      }));
      // release the operation lease even if monitoring never responds
      const response = await withGoogleCloudRequestTimeout((signal) =>
        fetchImpl(
          `https://monitoring.googleapis.com/v3/projects/${dependencies.projectId}/timeSeries`,
          {
            body: JSON.stringify({ timeSeries }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal,
          }
        )
      );
      // avoid response bodies because they can carry operational details
      if (!response.ok) {
        throw new Error("Google Monitoring metric export failed");
      }
    },
  };
}
