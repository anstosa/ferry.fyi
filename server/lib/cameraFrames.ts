import type {
  CameraFrameStatus,
  CameraFrameStatusResponse,
} from "shared/contracts/cameraFrames";
import type { CameraImage } from "shared/contracts/cameras";

interface CameraFrameSource {
  id: string;
  image: Pick<CameraImage, "url">;
}

interface CameraFrameState {
  inProgress?: Promise<CameraFrameStatus>;
  lastCheckedAtMs: number;
  status?: CameraFrameStatus;
}

interface CameraFrameTrackerOptions {
  fetchImpl?: typeof fetch;
  getNowMs?: () => number;
  minCheckIntervalMs?: number;
  staleThresholdMs?: number;
  timeoutMs?: number;
}

const DEFAULT_MIN_CHECK_INTERVAL_MS = 9500;
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

// parse HTTP date header
const parseHttpDate = (value: string | null): number | null => {
  // missing date guard
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  // invalid date guard
  if (Number.isNaN(time)) {
    return null;
  }
  return Math.floor(time / 1000);
};

// read response header
const getHeader = (response: Response, name: string): string | null =>
  response.headers.get(name);

// build stable frame token
const getFrameToken = (response: Response): string | null => {
  const parts = [
    getHeader(response, "etag"),
    getHeader(response, "last-modified"),
    getHeader(response, "content-length"),
  ].filter((value): value is string => Boolean(value));
  // no validator guard
  if (parts.length === 0) {
    return null;
  }
  return parts.join("|");
};

// resolve frame update time
const getFrameUpdatedAt = (
  checkedAt: number,
  frameToken: string | null,
  lastModifiedAt: number | null,
  previous?: CameraFrameStatus
): number | null => {
  // authoritative timestamp guard
  if (lastModifiedAt) {
    return lastModifiedAt;
  }
  // untrackable frame guard
  if (!frameToken) {
    return null;
  }
  // unchanged token guard
  if (previous?.frameToken === frameToken) {
    return previous.frameUpdatedAt;
  }
  return checkedAt;
};

// calculate stale state
const isFrameStale = (
  checkedAt: number,
  frameUpdatedAt: number | null,
  staleThresholdMs: number
): boolean => {
  // unknown freshness guard
  if (!frameUpdatedAt) {
    return false;
  }
  return checkedAt * 1000 - frameUpdatedAt * 1000 > staleThresholdMs;
};

// describe fetch failure
const getErrorMessage = (error: unknown): string => {
  // error object guard
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export class CameraFrameTracker {
  private fetchImpl: typeof fetch;
  private getNowMs: () => number;
  private minCheckIntervalMs: number;
  private staleThresholdMs: number;
  private states = new Map<string, CameraFrameState>();
  private timeoutMs: number;

  // configure tracker
  constructor(options: CameraFrameTrackerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getNowMs = options.getNowMs ?? Date.now;
    this.minCheckIntervalMs =
      options.minCheckIntervalMs ?? DEFAULT_MIN_CHECK_INTERVAL_MS;
    this.staleThresholdMs =
      options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // fetch current frame statuses
  async getStatuses(
    cameras: CameraFrameSource[]
  ): Promise<CameraFrameStatusResponse> {
    const statuses = await Promise.all(
      cameras.map(async (camera) => {
        return await this.getStatus(camera);
      })
    );
    return Object.fromEntries(
      statuses.map((status) => {
        return [status.cameraId, status];
      })
    );
  }

  // fetch or reuse a camera status
  private async getStatus(
    camera: CameraFrameSource
  ): Promise<CameraFrameStatus> {
    const nowMs = this.getNowMs();
    const state = this.states.get(camera.id);
    // in-flight guard
    if (state?.inProgress) {
      return await state.inProgress;
    }
    // recent status guard
    if (
      state?.status &&
      nowMs - state.lastCheckedAtMs < this.minCheckIntervalMs
    ) {
      return state.status;
    }
    const inProgress = this.refreshStatus(camera, state?.status, nowMs);
    this.states.set(camera.id, {
      ...state,
      inProgress,
      lastCheckedAtMs: nowMs,
    });
    return await inProgress;
  }

  // refresh one camera status
  private async refreshStatus(
    camera: CameraFrameSource,
    previous: CameraFrameStatus | undefined,
    nowMs: number
  ): Promise<CameraFrameStatus> {
    const checkedAt = Math.floor(nowMs / 1000);
    try {
      const status = await this.fetchStatus(camera, previous, checkedAt);
      this.states.set(camera.id, { lastCheckedAtMs: nowMs, status });
      return status;
    } catch (error) {
      const status = this.getFallbackStatus(
        camera,
        previous,
        checkedAt,
        getErrorMessage(error)
      );
      this.states.set(camera.id, { lastCheckedAtMs: nowMs, status });
      return status;
    }
  }

  // perform HEAD request
  private async fetchStatus(
    camera: CameraFrameSource,
    previous: CameraFrameStatus | undefined,
    checkedAt: number
  ): Promise<CameraFrameStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(camera.image.url, {
        method: "HEAD",
        signal: controller.signal,
      });
      // bad response guard
      if (!response.ok) {
        throw new Error(`HEAD ${response.status}`);
      }
      const lastModifiedAt = parseHttpDate(
        getHeader(response, "last-modified")
      );
      const frameToken = getFrameToken(response);
      const frameUpdatedAt = getFrameUpdatedAt(
        checkedAt,
        frameToken,
        lastModifiedAt,
        previous
      );
      return {
        cameraId: camera.id,
        checkedAt,
        error: null,
        frameToken,
        frameUpdatedAt,
        imageUrl: camera.image.url,
        isStale: isFrameStale(checkedAt, frameUpdatedAt, this.staleThresholdMs),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // reuse prior status on failure
  private getFallbackStatus(
    camera: CameraFrameSource,
    previous: CameraFrameStatus | undefined,
    checkedAt: number,
    error: string
  ): CameraFrameStatus {
    // previous status guard
    if (previous) {
      return {
        ...previous,
        checkedAt,
        error,
        isStale: isFrameStale(
          checkedAt,
          previous.frameUpdatedAt,
          this.staleThresholdMs
        ),
      };
    }
    return {
      cameraId: camera.id,
      checkedAt,
      error,
      frameToken: null,
      frameUpdatedAt: null,
      imageUrl: camera.image.url,
      isStale: false,
    };
  }
}

const cameraFrameTracker = new CameraFrameTracker();

// shared singleton tracker
export const getCameraFrameStatuses = (
  cameras: CameraFrameSource[]
): Promise<CameraFrameStatusResponse> =>
  cameraFrameTracker.getStatuses(cameras);
