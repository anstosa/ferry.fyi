import { Router } from "express";

import { getCameraFrameStatuses } from "~/lib/cameraFrames";
import { Camera } from "~/models/Camera";

const cameraRouter = Router();

// parse comma-separated camera ids
const parseCameraIds = (value: unknown): string[] => {
  // string query guard
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((id) => {
      return id.trim();
    })
    .filter(Boolean);
};

cameraRouter.get("/frames", async (request, response) => {
  const cameraIds = parseCameraIds(request.query.ids);
  const cameras = cameraIds
    .map((cameraId) => {
      return Camera.getByIndex(cameraId);
    })
    .filter((camera): camera is Camera => Boolean(camera));
  response.set("Cache-Control", "no-store");
  return response.json(await getCameraFrameStatuses(cameras));
});

export { cameraRouter };
