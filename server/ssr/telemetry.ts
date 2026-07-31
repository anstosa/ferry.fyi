import logger from "heroku-logger";

import type { SsrTelemetryEvent } from "./documentRuntime";

export type SsrTelemetrySink = (event: SsrTelemetryEvent) => void;

/**
 * SSR runtime events are already reduced to route/category/cache fields. Keep
 * the production sink at this typed boundary so request URLs, errors, and
 * snapshot contents cannot accidentally enter telemetry.
 */
export const reportProductionSsrTelemetry: SsrTelemetrySink = (event) => {
  logger.info("Public SSR telemetry", event);
};
