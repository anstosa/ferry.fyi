import { updateCameras } from "./updateCameras";
import { updateCapacity } from "./updateCapacity";
import { updateEstimates } from "../forecast";
import { updateRoutes } from "./updateRoutes";
import { updateSchedule } from "./updateSchedule";
import { updateTerminals } from "./updateTerminals";
import { updateVessels, updateVesselStatus } from "./updateVessels";

export const updateLong = async (): Promise<any> => {
  await updateCameras();
  await updateVessels();
  // routes relies on vessels
  await updateRoutes();
  // terminals relies on routes
  await updateTerminals();
  // schedule relies on terminals
  await updateSchedule();
};

export const updateShort = async (): Promise<void> => {
  await updateVesselStatus();
  await updateCapacity();
  await updateEstimates();
};
