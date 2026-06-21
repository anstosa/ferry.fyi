import logger from "heroku-logger";

import { updateEstimates } from "../forecast";
import { setWsfCoreReady, setWsfWarming } from "./api";
import { hydrateWsfSeed } from "./seed";
import { updateCameras } from "./updateCameras";
import { updateCapacity } from "./updateCapacity";
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
  await Promise.all([updateCameras(), updateVessels()]);
  // routes relies on vessels
  await updateRoutes();
  // terminals relies on routes and cameras
  await updateTerminals();
  setWsfCoreReady(true);
  setWsfWarming(false);
};

export const updateShort = async (): Promise<void> => {
  await updateVesselStatus();
  await updateCapacity();
  await updateEstimates();
};

// run background refresh
export const refreshWsfInBackground = (): void => {
  updateLong()
    .then(updateShort)
    .catch((error: Error) => {
      logger.error(`WSF background refresh failed: ${error.message}`, error);
      setWsfWarming(false);
    });
};
