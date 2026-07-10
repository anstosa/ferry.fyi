import type {
  CameraDetectionAreasConfig,
  CameraDetectionCameraConfig,
  CameraLineDetectionResponse,
  CameraLineDetectionStatus,
  VehicleDetection,
} from "shared/contracts/cameraDetection";
import cameraDetectionAreasData from "shared/data/camera-detection-areas.json";
import { countCameraDetections } from "shared/lib/cameraDetection";

import { getErrorMessage } from "./errors";

interface CameraLineDetectorContext {
  cameraId: string;
  contentType: string;
  image: ArrayBuffer;
  imageUrl: string;
}

interface DetectorAreaMask {
  allowedAreas: CameraDetectionCameraConfig["allowedAreas"];
  excludedAreas: CameraDetectionCameraConfig["excludedAreas"];
}

interface CameraLineDetectionRequestOptions {
  includeDetections?: boolean;
  refresh?: boolean;
}

interface CameraLineDetectionServiceOptions {
  detector?: (
    context: CameraLineDetectorContext
  ) => Promise<VehicleDetection[]>;
  detectorEndpoint?: string;
  fetchImpl?: typeof fetch;
  getNowMs?: () => number;
  minCheckIntervalMs?: number;
  timeoutMs?: number;
}

interface CameraLineDetectionState {
  inProgress?: Promise<CameraLineDetectionStatus>;
  lastCheckedAtMs: number;
  status?: CameraLineDetectionStatus;
}

const DEFAULT_MIN_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const detectionAreas =
  cameraDetectionAreasData as unknown as CameraDetectionAreasConfig;

// serialize detector-side image mask
const getDetectorAreaMask = (
  config: CameraDetectionCameraConfig
): DetectorAreaMask => ({
  allowedAreas: config.allowedAreas,
  excludedAreas: config.excludedAreas,
});

// remove optional qa detections
const stripDetectionDetails = (
  status: CameraLineDetectionStatus
): CameraLineDetectionStatus => {
  const nextStatus = { ...status };
  delete nextStatus.detections;
  return nextStatus;
};

// configured camera ids
export const getLineDetectionCameraIds = (): string[] =>
  detectionAreas.cameraIds.filter((cameraId) => {
    const camera = detectionAreas.cameras[cameraId];
    return camera.reviewed && camera.allowedAreas.length > 0;
  });

// get camera config
export const getLineDetectionCameraConfig = (
  cameraId: string
): CameraDetectionCameraConfig | null => {
  const camera = detectionAreas.cameras[cameraId];
  // missing config guard
  if (!camera) {
    return null;
  }
  return camera;
};

// validate finite number
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// validate detector box
const isVehicleDetectionBox = (box: unknown): boolean => {
  // object guard
  if (!box || typeof box !== "object") {
    return false;
  }
  const candidate = box as Record<string, unknown>;
  return (
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    isFiniteNumber(candidate.width) &&
    isFiniteNumber(candidate.height)
  );
};

// validate detector detection
const isVehicleDetectionShape = (
  detection: unknown
): detection is VehicleDetection => {
  // object guard
  if (!detection || typeof detection !== "object") {
    return false;
  }
  const candidate = detection as Record<string, unknown>;
  return (
    typeof candidate.label === "string" &&
    isFiniteNumber(candidate.confidence) &&
    isVehicleDetectionBox(candidate.box)
  );
};

// normalize endpoint detections
const parseDetectorResponse = (body: unknown): VehicleDetection[] => {
  // wrapper object guard
  if (!body || typeof body !== "object" || !("detections" in body)) {
    throw new Error("Detector response missing detections array");
  }
  const { detections } = body as { detections?: unknown };
  // array guard
  if (!Array.isArray(detections)) {
    throw new Error("Detector response detections must be an array");
  }
  // detection shape scan
  for (const detection of detections) {
    // detection shape guard
    if (!isVehicleDetectionShape(detection)) {
      throw new Error("Detector response contains malformed detection");
    }
  }
  return detections;
};

export class CameraLineDetectionService {
  private detector?: (
    context: CameraLineDetectorContext
  ) => Promise<VehicleDetection[]>;

  private detectorEndpoint?: string;
  private fetchImpl: typeof fetch;
  private getNowMs: () => number;
  private minCheckIntervalMs: number;
  private states = new Map<string, CameraLineDetectionState>();
  private timeoutMs: number;

  // configure service
  constructor(options: CameraLineDetectionServiceOptions = {}) {
    this.detector = options.detector;
    this.detectorEndpoint =
      options.detectorEndpoint ?? process.env.CAR_DETECTION_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getNowMs = options.getNowMs ?? Date.now;
    this.minCheckIntervalMs =
      options.minCheckIntervalMs ?? DEFAULT_MIN_CHECK_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // get line detections
  async getDetections(
    cameraIds = getLineDetectionCameraIds(),
    options: CameraLineDetectionRequestOptions = {}
  ): Promise<CameraLineDetectionResponse> {
    const statuses = await Promise.all(
      cameraIds.map(async (cameraId) => {
        return await this.getDetection(cameraId, options);
      })
    );
    return Object.fromEntries(
      statuses.map((status) => {
        return [status.cameraId, status];
      })
    );
  }

  // refresh configured cameras one at a time
  async refreshDetections(
    cameraIds = getLineDetectionCameraIds()
  ): Promise<void> {
    for (const cameraId of cameraIds) {
      await this.getDetection(cameraId, {});
    }
  }

  // get one line detection
  private async getDetection(
    cameraId: string,
    options: CameraLineDetectionRequestOptions
  ): Promise<CameraLineDetectionStatus> {
    const nowMs = this.getNowMs();
    const config = getLineDetectionCameraConfig(cameraId);
    // config guard
    if (!config) {
      return this.getEmptyStatus(
        cameraId,
        Math.floor(nowMs / 1000),
        "Camera is not configured",
        null
      );
    }
    const state = this.states.get(cameraId);
    // in-flight guard
    if (state?.inProgress) {
      return await state.inProgress;
    }
    // cached-only guard
    if (options.refresh === false) {
      return state?.status
        ? stripDetectionDetails(state.status)
        : this.getEmptyStatus(
            cameraId,
            Math.floor(nowMs / 1000),
            "No cached line detection status",
            config
          );
    }
    // recent status guard
    if (
      state?.status &&
      !options.includeDetections &&
      nowMs - state.lastCheckedAtMs < this.minCheckIntervalMs
    ) {
      return stripDetectionDetails(state.status);
    }
    const inProgress = this.refreshDetection(cameraId, nowMs, options);
    this.states.set(cameraId, {
      ...state,
      inProgress,
      lastCheckedAtMs: nowMs,
    });
    return await inProgress;
  }

  // refresh one line detection
  private async refreshDetection(
    cameraId: string,
    nowMs: number,
    options: CameraLineDetectionRequestOptions
  ): Promise<CameraLineDetectionStatus> {
    const checkedAt = Math.floor(nowMs / 1000);
    const config = getLineDetectionCameraConfig(cameraId);
    // config guard
    if (!config) {
      return this.getEmptyStatus(
        cameraId,
        checkedAt,
        "Camera is not configured",
        null
      );
    }
    try {
      const detections = await this.detectVehicles(cameraId, config);
      const status = {
        ...countCameraDetections(
          cameraId,
          config,
          detections,
          options.includeDetections
        ),
        checkedAt,
        error: null,
      };
      this.states.set(cameraId, {
        lastCheckedAtMs: nowMs,
        status: stripDetectionDetails(status),
      });
      return status;
    } catch (error) {
      const status = this.getEmptyStatus(
        cameraId,
        checkedAt,
        getErrorMessage(error),
        config
      );
      this.states.set(cameraId, { lastCheckedAtMs: nowMs, status });
      return status;
    }
  }

  // detect vehicles from image
  private async detectVehicles(
    cameraId: string,
    config: CameraDetectionCameraConfig
  ): Promise<VehicleDetection[]> {
    const context = await this.fetchCameraImage(cameraId, config);
    // injected detector guard
    if (this.detector) {
      return await this.detector(context);
    }
    // endpoint guard
    if (!this.detectorEndpoint) {
      throw new Error("CAR_DETECTION_ENDPOINT is not configured");
    }
    const response = await this.fetchWithTimeout(
      this.detectorEndpoint,
      {
        body: context.image,
        headers: {
          "Content-Type": context.contentType || "application/octet-stream",
          "X-Camera-Id": cameraId,
          "X-Detection-Areas": JSON.stringify(getDetectorAreaMask(config)),
          "X-Image-Url": config.imageUrl,
        },
        method: "POST",
      },
      "Detector request"
    );
    // detector failure guard
    if (!response.ok) {
      throw new Error(`Detector HTTP ${response.status}`);
    }
    return parseDetectorResponse(await response.json());
  }

  // fetch current camera image
  private async fetchCameraImage(
    cameraId: string,
    config: CameraDetectionCameraConfig
  ): Promise<CameraLineDetectorContext> {
    const response = await this.fetchWithTimeout(
      config.imageUrl,
      undefined,
      "Image request"
    );
    // image failure guard
    if (!response.ok) {
      throw new Error(`Image HTTP ${response.status}`);
    }
    return {
      cameraId,
      contentType: response.headers.get("content-type") ?? "image/jpeg",
      image: await response.arrayBuffer(),
      imageUrl: config.imageUrl,
    };
  }

  // fetch with timeout
  private async fetchWithTimeout(
    url: string,
    init: RequestInit | undefined,
    label: string
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    // request timeout
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      // timeout guard
      if (timedOut) {
        throw new Error(`${label} timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // empty status helper
  private getEmptyStatus(
    cameraId: string,
    checkedAt: number,
    error: string,
    config: CameraDetectionCameraConfig | null = getLineDetectionCameraConfig(
      cameraId
    )
  ): CameraLineDetectionStatus {
    return {
      areaCounts:
        config?.allowedAreas.map((area) => {
          return {
            areaId: area.id,
            label: area.label,
            type: area.type,
            vehicleCount: 0,
          };
        }) ?? [],
      cameraId,
      checkedAt,
      detectionCount: 0,
      error,
      excludedDetectionCount: 0,
      imageUrl: config?.imageUrl ?? "",
      includedDetectionCount: 0,
      occupancyPercent: null,
      reviewed: config?.reviewed ?? false,
      vehicleCapacity: null,
    };
  }
}

const cameraLineDetectionService = new CameraLineDetectionService();

// shared singleton detector
export const getCameraLineDetections = (
  cameraIds?: string[],
  options?: CameraLineDetectionRequestOptions
): Promise<CameraLineDetectionResponse> =>
  cameraLineDetectionService.getDetections(cameraIds, options);

// warm the public cache without detector bursts
export const refreshCameraLineDetectionCache = (): Promise<void> =>
  cameraLineDetectionService.refreshDetections();
