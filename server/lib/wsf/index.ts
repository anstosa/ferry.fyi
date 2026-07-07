import logger from "heroku-logger";

import { getErrorMessage, getLogError } from "~/lib/errors";
import type { Schedule } from "~/models/Schedule";

import { sendCancellationNotifications } from "../cancellationNotifications";
import { sendDelayNotifications } from "../delayNotifications";
import { updateEstimates } from "../forecast";
import { sendSailingLifecycleNotifications } from "../sailingLifecycleNotifications";
import { updateTideForecasts } from "../tides/updateForecasts";
import { updateWeatherForecasts } from "../weather/updateForecasts";
import { setWsfCoreReady, setWsfWarming } from "./api";
import { hydrateWsfSeed } from "./seed";
import { updateCameras } from "./updateCameras";
import { updateCapacity } from "./updateCapacity";
import { updateNormalRouteVessels } from "./updateNormalRouteVessels";
import { updateRoutes } from "./updateRoutes";
import { updateSchedules } from "./updateSchedules";
import { updateTerminals } from "./updateTerminals";
import { updateVessels, updateVesselStatus } from "./updateVessels";

const ESTIMATE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ENVIRONMENT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

interface ShortRefreshOptions {
  sendNotifications?: boolean;
}

interface BackgroundRefreshOptions extends ShortRefreshOptions {}
let estimateRefreshPromise: Promise<void> | null = null;
let lastEstimateRefreshStartedAt = 0;
let lastTideForecastRefreshStartedAt = 0;
let lastWeatherForecastRefreshStartedAt = 0;
let longRefreshPromise: Promise<void> | null = null;
let shortRefreshPromise: Promise<void> | null = null;
let tideForecastRefreshPromise: Promise<void> | null = null;
let weatherForecastRefreshPromise: Promise<void> | null = null;

// refresh estimates without blocking short refresh
const refreshEstimatesBestEffort = (schedules: Schedule[]): void => {
  // empty estimate guard
  if (!schedules.length) {
    return;
  }
  // overlap guard
  if (estimateRefreshPromise) {
    logger.info("Skipped estimate refresh; previous refresh is still running");
    return;
  }
  const now = Date.now();
  // rate limit guard
  if (now - lastEstimateRefreshStartedAt < ESTIMATE_REFRESH_INTERVAL_MS) {
    logger.info("Skipped estimate refresh; recent refresh already ran");
    return;
  }
  lastEstimateRefreshStartedAt = now;
  estimateRefreshPromise = updateEstimates(schedules)
    .catch((error: unknown) => {
      // estimate failure log
      logger.error(
        `Estimate refresh failed: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    })
    .finally(() => {
      // clear in-flight estimate guard
      estimateRefreshPromise = null;
    });
};

// refresh tide forecasts without blocking short refresh
const refreshTideForecastsBestEffort = (): void => {
  // overlap guard
  if (tideForecastRefreshPromise) {
    logger.info(
      "Skipped tide forecast refresh; previous refresh is still running"
    );
    return;
  }
  const now = Date.now();
  // rate limit guard
  if (
    now - lastTideForecastRefreshStartedAt <
    ENVIRONMENT_REFRESH_INTERVAL_MS
  ) {
    logger.info("Skipped tide forecast refresh; recent refresh already ran");
    return;
  }
  lastTideForecastRefreshStartedAt = now;
  tideForecastRefreshPromise = updateTideForecasts()
    .then(() => undefined)
    .catch((error: unknown) => {
      // tide failure log
      logger.error(
        `Tide forecast refresh failed: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    })
    .finally(() => {
      // clear in-flight tide guard
      tideForecastRefreshPromise = null;
    });
};

// refresh weather forecasts without blocking short refresh
const refreshWeatherForecastsBestEffort = (): void => {
  // overlap guard
  if (weatherForecastRefreshPromise) {
    logger.info(
      "Skipped weather forecast refresh; previous refresh is still running"
    );
    return;
  }
  const now = Date.now();
  // rate limit guard
  if (
    now - lastWeatherForecastRefreshStartedAt <
    ENVIRONMENT_REFRESH_INTERVAL_MS
  ) {
    logger.info("Skipped weather forecast refresh; recent refresh already ran");
    return;
  }
  lastWeatherForecastRefreshStartedAt = now;
  weatherForecastRefreshPromise = updateWeatherForecasts()
    .then(() => undefined)
    .catch((error: unknown) => {
      // weather failure log
      logger.error(
        `Weather forecast refresh failed: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    })
    .finally(() => {
      // clear in-flight weather guard
      weatherForecastRefreshPromise = null;
    });
};

// load instant seed
export const initializeWsfSeed = (): void => {
  hydrateWsfSeed();
  setWsfCoreReady(true);
};

// run long refresh work
const runLongRefresh = async (): Promise<void> => {
  setWsfWarming(true);
  try {
    await Promise.all([updateCameras(), updateVessels()]);
    // routes relies on vessels
    await updateRoutes();
    // terminals relies on routes and cameras
    await updateTerminals();
    setWsfCoreReady(true);
  } finally {
    // clear warming state
    setWsfWarming(false);
  }
};

export const updateLong = async (): Promise<void> => {
  // overlap guard
  if (longRefreshPromise) {
    logger.info("Skipped long WSF refresh; previous refresh is still running");
    return;
  }
  longRefreshPromise = runLongRefresh().finally(() => {
    // clear in-flight guard
    longRefreshPromise = null;
  });
  await longRefreshPromise;
};

// run daily route-vessel inference
export const updateDaily = async (): Promise<void> => {
  await updateNormalRouteVessels();
};

// run schedule cache refresh
export const updateScheduleCache = async (): Promise<void> => {
  await updateSchedules();
};

// run short refresh work
const runShortRefresh = async (
  options: ShortRefreshOptions = {}
): Promise<void> => {
  // short refresh
  try {
    await updateVesselStatus();
    const updatedSchedules = await updateCapacity();
    refreshEstimatesBestEffort(updatedSchedules);
    // notification guard
    if (options.sendNotifications !== false) {
      await sendCancellationNotifications();
      await sendDelayNotifications();
      await sendSailingLifecycleNotifications();
    }
  } finally {
    // tide best-effort
    refreshTideForecastsBestEffort();
    // weather best-effort
    refreshWeatherForecastsBestEffort();
  }
};

const runShortRefreshWithOverlapGuard = async (
  options: ShortRefreshOptions = {}
): Promise<void> => {
  // overlap guard
  if (shortRefreshPromise) {
    logger.info("Skipped short WSF refresh; previous refresh is still running");
    return;
  }
  shortRefreshPromise = runShortRefresh(options).finally(() => {
    // clear in-flight guard
    shortRefreshPromise = null;
  });
  await shortRefreshPromise;
};

// refresh user caches
export const updateUserFacingStatus = async (): Promise<void> => {
  await runShortRefreshWithOverlapGuard({ sendNotifications: false });
};

// refresh scheduler jobs
export const updateShort = async (): Promise<void> => {
  await runShortRefreshWithOverlapGuard({ sendNotifications: true });
};

// run background refresh
export const refreshWsfInBackground = (
  options: BackgroundRefreshOptions = {}
): void => {
  const shortRefresh =
    options.sendNotifications === false ? updateUserFacingStatus : updateShort;
  // warm user-facing caches
  updateLong()
    .then(shortRefresh)
    .then(updateScheduleCache)
    .catch((error: Error) => {
      logger.error(`WSF background refresh failed: ${error.message}`, error);
      setWsfWarming(false);
    });
};
