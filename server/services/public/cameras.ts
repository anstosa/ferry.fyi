import { getCameraFrameStatuses } from "~/lib/cameraFrames";
import {
  getCameraLineDetections,
  getLineDetectionCameraIds,
} from "~/lib/cameraLineDetection";
import { Camera } from "~/models/Camera";

const MAX_LINE_DETECTION_CAMERA_IDS = 25;

export const selectPublicLineDetectionCameraIds = (
  requestedCameraIds: string[]
): { cameraIds: string[]; invalidCameraIds: string[] } => {
  const selectedCameraIds =
    requestedCameraIds.length > 0
      ? requestedCameraIds
      : getLineDetectionCameraIds();
  const validCameraIds = new Set(getLineDetectionCameraIds());
  const cameraIds: string[] = [];
  const invalidCameraIds: string[] = [];
  const seenCameraIds = new Set<string>();
  for (const cameraId of selectedCameraIds) {
    if (seenCameraIds.has(cameraId)) {
      continue;
    }
    seenCameraIds.add(cameraId);
    if (!validCameraIds.has(cameraId)) {
      invalidCameraIds.push(cameraId);
      continue;
    }
    if (cameraIds.length < MAX_LINE_DETECTION_CAMERA_IDS) {
      cameraIds.push(cameraId);
    }
  }
  return { cameraIds, invalidCameraIds };
};

/**
 * Read only already-cached public detection summaries. This deliberately uses
 * the lib singleton, preserving its tracker/cache coalescing behavior.
 */
export const getPublicCameraLineDetections = (
  cameraIds: string[]
): Promise<Awaited<ReturnType<typeof getCameraLineDetections>>> =>
  getCameraLineDetections(cameraIds, {
    includeDetections: false,
    refresh: false,
  });

/** Return public frame statuses and their oldest available source timestamp. */
export const getPublicCameraFrames = async (cameraIds: string[]) => {
  const cameras = cameraIds
    .map((cameraId) => Camera.getByIndex(cameraId))
    .filter((camera): camera is Camera => Boolean(camera));
  const frames = await getCameraFrameStatuses(cameras);
  const sourceTimes = Object.values(frames)
    .map(({ frameUpdatedAt }) => frameUpdatedAt)
    .filter((time): time is number => typeof time === "number");
  return {
    frames,
    sourceUpdatedAt: sourceTimes.length ? Math.min(...sourceTimes) : null,
  };
};
