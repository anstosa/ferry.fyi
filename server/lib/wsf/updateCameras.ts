import cameras from "shared/data/cameras.json";
import { values } from "shared/lib/objects";

import logger from "~/lib/logger";
import { formatLogBlock, formatTerminalList } from "~/lib/logging";
import { Camera } from "~/models/Camera";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";

// keep camera refresh inside the fixed WSF origin
const API_CAMERAS = "https://www.wsdot.wa.gov/ferries/vesselwatch/Cameras.ashx";
const UNCONFIGURED_CAMERA_ORDER = Number.MAX_SAFE_INTEGER;

// import upstream cameras with conservative defaults and reviewed overrides
export const updateCameras = async (): Promise<void> => {
  logger.info("Started camera update");
  const response = await wsfRequest<WSF.CamerasResponse>(API_CAMERAS);
  // missing camera response guard
  if (!response) {
    logger.info("Skipped camera update; WSF returned no cameras");
    return;
  }
  const terminalIds = new Set<string>();
  // normalize every upstream camera before storing it
  response.FeedContentList.forEach(({ TerminalID, FerryCamera }) => {
    terminalIds.add(String(TerminalID));
    const data = {
      // preserve unknown capacity as explicit absence
      carCapacity: null,
      carsToBoat: null,
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
      // place unreviewed cameras after configured queue cameras
      orderFromTerminal: UNCONFIGURED_CAMERA_ORDER,
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
