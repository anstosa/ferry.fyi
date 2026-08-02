import { getWsfStatus } from "~/lib/wsf/api";
import { getPublicCameraFrames } from "~/services/public/cameras";
import { getPublicContent } from "~/services/public/content";
import { createPublicFareQueryService } from "~/services/public/fares";
import {
  getPublicLeaderboard,
  publicLeaderboardsEnabled,
} from "~/services/public/leaderboards";
import { getPublicSsrSchedule } from "~/services/public/schedules";
import { getPublicTerminals } from "~/services/public/terminals";
import { getPublicVessels } from "~/services/public/vessels";

import { createSsrConfig, type SsrConfig } from "./config";
import { SsrDocumentCache } from "./documentCache";
import {
  createSsrDocumentRuntime,
  type SsrRuntimeFill,
  type SsrTelemetryEvent,
} from "./documentRuntime";
import {
  createPublicSsrCanonicalResolver,
  createPublicSsrSnapshotLoader,
  type PublicSsrSnapshotServices,
} from "./publicSnapshot";
import { reportProductionSsrTelemetry } from "./telemetry";

export interface SsrRuntimeCompositionOptions {
  artifacts: {
    getRenderer(): Promise<
      import("shared/contracts/ssrRenderer").PublicSsrRendererArtifact
    >;
    getTemplate(): Promise<string>;
  };
  config?: SsrConfig;
  /** Injectable so production telemetry and fixtures share the same boundary. */
  telemetry?: (event: SsrTelemetryEvent) => void;
}

/** Wires server-only public services to the pure document runtime. */
export const createSsrRuntime = async ({
  artifacts,
  config = createSsrConfig(),
  telemetry = reportProductionSsrTelemetry,
}: SsrRuntimeCompositionOptions) => {
  const [renderer, template] = await Promise.all([
    artifacts.getRenderer(),
    artifacts.getTemplate(),
  ]);
  const fareQueries = createPublicFareQueryService();
  const services: PublicSsrSnapshotServices = {
    getCameraFrames: getPublicCameraFrames,
    getContent: getPublicContent,
    getFareCatalog: fareQueries.getCatalog,
    getLeaderboard: getPublicLeaderboard,
    getPublicLeaderboardsEnabled: publicLeaderboardsEnabled,
    getSchedule: getPublicSsrSchedule,
    getTerminals: getPublicTerminals,
    getVessels: async () => {
      const vessels = await getPublicVessels();
      return Object.fromEntries(
        Object.entries(vessels).map(([id, vessel]) => [id, { ...vessel }])
      );
    },
    getWsfStatus: () => Promise.resolve(getWsfStatus()),
  };
  const release = () => ({
    publishedAt: process.env.HEROKU_RELEASE_CREATED_AT ?? null,
    version: process.env.HEROKU_RELEASE_VERSION ?? "development",
  });
  return createSsrDocumentRuntime({
    cache: new SsrDocumentCache<SsrRuntimeFill>(),
    clock: () => new Date(),
    config,
    contentRevision: () => release().version,
    load: createPublicSsrSnapshotLoader({ services }),
    release,
    renderer,
    resolve: createPublicSsrCanonicalResolver({
      getTerminals: getPublicTerminals,
    }),
    template,
    telemetry,
  });
};
