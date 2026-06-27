import type { CameraFrameStatusResponse } from "shared/contracts/cameraFrames";

import { get } from "~/lib/api";

// build frame metadata URL
const getApiCameraFrames = (cameraIds: string[]): string =>
  `/cameras/frames?ids=${cameraIds.map(encodeURIComponent).join(",")}`;

// fetch active camera frame metadata
export const getCameraFrames = (
  cameraIds: string[]
): Promise<CameraFrameStatusResponse> => {
  return get<CameraFrameStatusResponse>(getApiCameraFrames(cameraIds));
};
