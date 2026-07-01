import logger from "heroku-logger";
import cameras from "shared/data/cameras.json";
import { values } from "shared/lib/objects";

import { formatLogBlock, formatTerminalList } from "~/lib/logging";
import { Camera } from "~/models/Camera";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";

const API_CAMERAS = "https://www.wsdot.com/ferries/vesselwatch/Cameras.ashx";

export const updateCameras = async (): Promise<void> => {
  logger.info("Started camera update");
  const response = await wsfRequest<WSF.CamerasResponse>(API_CAMERAS);
  // missing camera response guard
  if (!response) {
    logger.info("Skipped camera update; WSF returned no cameras");
    return;
  }
  const terminalIds = new Set<string>();
  response.FeedContentList.forEach(({ TerminalID, FerryCamera }) => {
    terminalIds.add(String(TerminalID));
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
    // created camera guard
    if (wasCreated) {
      camera.save();
      return;
    }
    camera.update(data);
    camera.save();
  });
  // Add any cameras missing in the API
  values(cameras as Record<string, Partial<Camera>>)
    .filter(({ id }) => String(id).substr(0, 4) === "fyi")
    .forEach((data) => {
      const [camera, wasCreated] = Camera.getOrCreate(String(data?.id), data);
      // created camera guard
      if (wasCreated) {
        camera.save();
        return;
      }
      camera.update(data);
      camera.save();
    });
  logger.info(
    formatLogBlock("Camera update complete", [
      {
        heading: "summary",
        lines: [`cameras: ${Object.keys(Camera.getAll()).length}`],
      },
      {
        heading: "terminals",
        lines: formatTerminalList(Array.from(terminalIds)),
      },
    ])
  );
};
