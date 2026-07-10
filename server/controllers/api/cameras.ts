import { Router } from "express";

import { getCameraFrameStatuses } from "~/lib/cameraFrames";
import {
  getCameraLineDetections,
  getLineDetectionCameraIds,
} from "~/lib/cameraLineDetection";
import { Camera } from "~/models/Camera";

const cameraRouter = Router();
const MAX_LINE_DETECTION_CAMERA_IDS = 25;

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

// validate public line detection ids
const getValidatedLineDetectionCameraIds = (
  requestedCameraIds: string[]
): { cameraIds: string[]; invalidCameraIds: string[] } => {
  const validCameraIds = new Set(getLineDetectionCameraIds());
  const cameraIds: string[] = [];
  const invalidCameraIds: string[] = [];
  const seenCameraIds = new Set<string>();
  // requested id scan
  for (const cameraId of requestedCameraIds) {
    // duplicate guard
    if (seenCameraIds.has(cameraId)) {
      continue;
    }
    seenCameraIds.add(cameraId);
    // unknown id guard
    if (!validCameraIds.has(cameraId)) {
      invalidCameraIds.push(cameraId);
      continue;
    }
    // cap guard
    if (cameraIds.length >= MAX_LINE_DETECTION_CAMERA_IDS) {
      continue;
    }
    cameraIds.push(cameraId);
  }
  return { cameraIds, invalidCameraIds };
};

cameraRouter.get("/line-detection", async (request, response) => {
  const requestedCameraIds = parseCameraIds(request.query.ids);
  const { cameraIds, invalidCameraIds } = getValidatedLineDetectionCameraIds(
    requestedCameraIds.length > 0
      ? requestedCameraIds
      : getLineDetectionCameraIds()
  );
  // invalid id guard
  if (invalidCameraIds.length > 0) {
    return response.status(400).json({
      error: "Invalid camera ids",
      invalidCameraIds,
    });
  }
  response.set("Cache-Control", "no-store");
  return response.json(
    await getCameraLineDetections(cameraIds, {
      // public cache only
      includeDetections: false,
      refresh: false,
    })
  );
});

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
