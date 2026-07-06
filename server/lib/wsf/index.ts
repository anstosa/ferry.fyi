import logger from "heroku-logger";

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
import { updateTerminals } from "./updateTerminals";
import { updateVessels, updateVesselStatus } from "./updateVessels";

// load instant seed
export const initializeWsfSeed = (): void => {
  hydrateWsfSeed();
  setWsfCoreReady(true);
};

export const updateLong = async (): Promise<void> => {
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

// run daily route-vessel inference
export const updateDaily = async (): Promise<void> => {
  await updateNormalRouteVessels();
};

export const updateShort = async (): Promise<void> => {
  // short refresh
  try {
    await updateVesselStatus();
    const updatedSchedules = await updateCapacity();
    await updateEstimates(updatedSchedules);
    await sendCancellationNotifications();
    await sendDelayNotifications();
    await sendSailingLifecycleNotifications();
  } finally {
    // tide best-effort
    updateTideForecasts().catch((error) => {
      // preserve estimate refresh
      logger.error(
        `Tide forecast refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
    // weather best-effort
    updateWeatherForecasts().catch((error) => {
      // preserve estimate refresh
      logger.error(
        `Weather forecast refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }
};

// run background refresh
export const refreshWsfInBackground = (): void => {
  updateLong()
    .then(updateShort)
    .then(updateDaily)
    .catch((error: Error) => {
      logger.error(`WSF background refresh failed: ${error.message}`, error);
      setWsfWarming(false);
    });
};
