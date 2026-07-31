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

/**
 * Closed anonymous frame state used by SSR documents. `frameToken` is an
 * opaque public cache identity for the image, never a credential.
 */
export interface PublicSsrCameraFrameStatus {
  cameraId: string;
  checkedAt: number;
  frameToken: string | null;
  frameUpdatedAt: number | null;
  imageUrl: string;
  isStale: boolean;
  status: "available" | "unavailable";
}

/** Public SSR frame envelope deliberately omits transport error details. */
export interface PublicSsrCameraFrameStatusEnvelope {
  frames: Record<string, PublicSsrCameraFrameStatus>;
  /** Oldest known source image time among the requested cameras. */
  sourceUpdatedAt: number | null;
}
