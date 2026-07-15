export interface CameraFrameStatus {
  cameraId: string;
  checkedAt: number;
  error: string | null;
  frameToken: string | null;
  frameUpdatedAt: number | null;
  imageUrl: string;
  isStale: boolean;
}

export type CameraFrameStatusResponse = Record<string, CameraFrameStatus>;

export interface CameraFrameStatusEnvelope {
  frames: CameraFrameStatusResponse;
  /** Oldest known source image time among the requested cameras. */
  sourceUpdatedAt: number | null;
}
