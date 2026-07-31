import { Router } from "express";

import {
  getPublicCameraFrames,
  getPublicCameraLineDetections,
  selectPublicLineDetectionCameraIds,
} from "~/services/public/cameras";

const cameraRouter = Router();

const parseCameraIds = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

cameraRouter.get("/line-detection", async (request, response) => {
  const selection = selectPublicLineDetectionCameraIds(
    parseCameraIds(request.query.ids)
  );
  if (selection.invalidCameraIds.length > 0) {
    return response.status(400).json({
      error: "Invalid camera ids",
      invalidCameraIds: selection.invalidCameraIds,
    });
  }
  response.set("Cache-Control", "no-store");
  return response.json(
    await getPublicCameraLineDetections(selection.cameraIds)
  );
});

cameraRouter.get("/frames", async (request, response) => {
  response.set("Cache-Control", "no-store");
  return response.json(
    await getPublicCameraFrames(parseCameraIds(request.query.ids))
  );
});

export { cameraRouter };
