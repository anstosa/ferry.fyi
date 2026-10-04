import { createAwsWifTokenProvider } from "~/lib/googleCloud/awsWif";
import {
  createGoogleMonitoringWriter,
  type GoogleMonitoringWriter,
} from "~/lib/googleCloud/monitoring";
import {
  getGoogleRoutesPacificMonth,
  readCurrentGoogleRoutesUsage,
} from "~/lib/googleRoutesUsage";

export interface GoogleRoutesUsageExportResult {
  month: string;
  seriesCount: number;
}

/** exports all estimated monthly sku gauges, including zero heartbeats */
export async function exportGoogleRoutesUsage(
  dependencies: {
    at?: Date;
    env?: NodeJS.ProcessEnv;
    readUsage?: typeof readCurrentGoogleRoutesUsage;
    writer?: GoogleMonitoringWriter;
  } = {}
): Promise<GoogleRoutesUsageExportResult> {
  const at = dependencies.at ?? new Date();
  const env = dependencies.env ?? process.env;
  const readUsage = dependencies.readUsage ?? readCurrentGoogleRoutesUsage;
  let { writer } = dependencies;
  // create production WIF dependencies only when not injected
  if (!writer) {
    const {
      AWS_REGION: awsRegion,
      GOOGLE_MONITORING_PROJECT_ID: projectId,
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER: providerResource,
    } = env;
    // fail closed until all external readiness values are present
    if (!projectId || !providerResource || !awsRegion) {
      throw new Error("Google Routes Monitoring export is not configured");
    }
    const tokenProvider = createAwsWifTokenProvider({
      awsRegion,
      providerResource,
    });
    writer = createGoogleMonitoringWriter({
      getAccessToken: () => tokenProvider.getAccessToken(),
      projectId,
    });
  }
  const snapshots = await readUsage(at);
  await writer.writeGoogleRoutesUsage(snapshots, at);
  return {
    month: getGoogleRoutesPacificMonth(at),
    seriesCount: snapshots.length,
  };
}
