import { Camera } from "~/models/Camera";
import { wsfRequest } from "./api";
import logger from "heroku-logger";

const API_CAMERAS = "https://www.wsdot.com/ferries/vesselwatch/Cameras.ashx";

export const updateCameras = async (): Promise<void> => {
  logger.info("Started Camera Update");
  const response = await wsfRequest<CamerasResponse>(API_CAMERAS);
  if (!response) {
    return;
  }
  response.FeedContentList.forEach(({ TerminalID, FerryCamera }) => {
    const data = {
      id: String(FerryCamera.CamID),
      terminalId: String(TerminalID),
      location: {
        latitude: FerryCamera.Lat,
        longitude: FerryCamera.Lon,
      },
      title: FerryCamera.Title,
      image: {
        url: FerryCamera.ImgURL,
        width: FerryCamera.ImgWidth,
        height: FerryCamera.ImgHeight,
      },
      owner: FerryCamera.CamOwner
        ? {
            name: FerryCamera.CamOwner,
            url: FerryCamera.OwnerURL,
          }
        : null,
      isActive: FerryCamera.IsActive,
    };
    const [camera, wasCreated] = Camera.getOrCreate(
      String(FerryCamera.CamID),
      data
    );
    if (!wasCreated) {
      camera.update(data);
    }
    camera.save();
  });
};
