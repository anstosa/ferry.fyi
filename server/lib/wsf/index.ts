import { updateCameras } from "./updateCameras";
import { updateCapacity } from "./updateCapacity";
import { updateEstimates, updateSchedule } from "./updateSchedule";
import { updateRoutes } from "./updateRoutes";
import { updateTerminals } from "./updateTerminals";
import { updateVessels, updateVesselStatus } from "./updateVessels";

export const updateLong = async (): Promise<any> => {
  await updateCameras();
  await updateVessels();
  // routes relies on vessels
  await updateRoutes();
  // schedule relies on vessels
  await updateSchedule();
  // terminals relies on schedule
  await updateTerminals();
};

export const updateShort = async (): Promise<void> => {
  await updateVesselStatus();
  await updateCapacity();
  updateEstimates();
};
