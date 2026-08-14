import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { type RequestHandler, type Response, Router } from "express";
import { MINUTE, rateLimit } from "express-rate-limit";
import logger from "heroku-logger";
import type {
  CameraAreaOccupancyState,
  CameraDetectionArea,
  CameraDetectionAreasConfig,
  CameraDetectionCameraConfig,
} from "shared/contracts/cameraDetection";
import { isObject } from "shared/lib/objects";

import {
  deleteCameraCaptureRun,
  importCameraCaptureRun,
  listCameraCaptureRuns,
  startCameraCaptureRun,
  stopCameraCaptureRun,
  validateCameraCaptureRunRequest,
} from "~/lib/cameraDetectionCaptureRuns";
import { getErrorMessage } from "~/lib/errors";

const CAMERA_IMAGE_HOST = "images.wsdot.wa.gov";
const OCCUPANCY_STATES = new Set<CameraAreaOccupancyState>([
  "empty",
  "minority_full",
  "majority_full",
  "full",
]);

interface BenchmarkFrame {
  cameraId: string;
  contentType: string;
  file: string;
  frameId: string;
}

interface BenchmarkManifest {
  frames: BenchmarkFrame[];
}

interface CameraDetectionDebuggerPaths {
  annotationFile: string;
  benchmarkLabelsFile: string;
  benchmarkManifestFile: string;
  benchmarkRoot: string;
  cameraOverridesFile: string;
  captureRoot: string;
  recorderScript: string;
}

interface CameraDetectionDebuggerOptions {
  detectorUrl?: string;
  fetchImpl?: typeof fetch;
  paths?: Partial<CameraDetectionDebuggerPaths>;
  rateLimiter?: RequestHandler;
}

interface CameraDetectionDebuggerPageOptions {
  debuggerHtmlFile?: string;
}

const repositoryRoot = path.resolve(__dirname, "../../..");
const defaultDebuggerHtmlFile = path.join(
  repositoryRoot,
  "scripts/camera-polygon-annotator/index.html"
);
const defaultPaths: CameraDetectionDebuggerPaths = {
  annotationFile: path.join(
    repositoryRoot,
    "shared/data/camera-detection-areas.json"
  ),
  benchmarkLabelsFile: path.join(
    repositoryRoot,
    "benchmarks/camera-detection/labels.json"
  ),
  benchmarkManifestFile: path.join(
    repositoryRoot,
    "benchmarks/camera-detection/manifest.json"
  ),
  benchmarkRoot: path.join(repositoryRoot, "benchmarks/camera-detection"),
  cameraOverridesFile: path.join(repositoryRoot, "shared/data/cameras.json"),
  captureRoot: path.join(
    repositoryRoot,
    "benchmarks/camera-detection/captures"
  ),
  recorderScript: path.join(
    repositoryRoot,
    "scripts/record-camera-detection-frames.py"
  ),
};

// resolve local and container detector endpoints
export const getCameraDetectionDebuggerDetectorUrl = (): string =>
  process.env.FERRY_DETECTOR_URL ||
  process.env.CAR_DETECTION_ENDPOINT ||
  "http://127.0.0.1:8001/detect";

// send an unwrapped debugger response
const sendRawJson = (
  response: Response,
  status: number,
  payload: unknown
): void => {
  response
    .status(status)
    .type("application/json")
    .end(`${JSON.stringify(payload)}\n`);
};

// bound debugger file and detector work
export const createCameraDetectionDebuggerRateLimiter = ({
  limit = 60,
  windowMs = MINUTE,
}: {
  limit?: number;
  windowMs?: number;
} = {}): RequestHandler =>
  rateLimit({
    // preserve raw debugger protocol
    handler: (_request, response) => {
      sendRawJson(response, 429, { error: "Rate limit exceeded" });
    },
    identifier: "camera-detection-debugger",
    legacyHeaders: false,
    limit,
    standardHeaders: "draft-8",
    windowMs,
  });

// read one repository JSON document
const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

// replace one repository JSON document atomically
const writeJson = async (file: string, payload: unknown): Promise<void> => {
  const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryFile,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryFile, file);
};

// isolate a buffer's exact byte range
const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

// validate one normalized point
const isDetectionPoint = (point: unknown): boolean =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every(
    (coordinate) =>
      typeof coordinate === "number" &&
      Number.isFinite(coordinate) &&
      coordinate >= 0 &&
      coordinate <= 1
  );

// validate one configured polygon
const isDetectionArea = (area: unknown): area is CameraDetectionArea =>
  isObject(area) &&
  typeof area.id === "string" &&
  area.id.trim().length > 0 &&
  typeof area.label === "string" &&
  area.label.trim().length > 0 &&
  typeof area.type === "string" &&
  Array.isArray(area.polygon) &&
  area.polygon.length >= 3 &&
  area.polygon.every(isDetectionPoint);

// validate one camera entry
const isDetectionCamera = (
  camera: unknown
): camera is CameraDetectionCameraConfig =>
  isObject(camera) &&
  typeof camera.terminal === "string" &&
  typeof camera.terminalId === "string" &&
  typeof camera.displayName === "string" &&
  typeof camera.title === "string" &&
  typeof camera.imageUrl === "string" &&
  typeof camera.reviewed === "boolean" &&
  typeof camera.requiresDaylightReview === "boolean" &&
  isObject(camera.frameSize) &&
  typeof camera.frameSize.width === "number" &&
  camera.frameSize.width > 0 &&
  typeof camera.frameSize.height === "number" &&
  camera.frameSize.height > 0 &&
  Array.isArray(camera.allowedAreas) &&
  camera.allowedAreas.every(isDetectionArea) &&
  Array.isArray(camera.excludedAreas) &&
  camera.excludedAreas.every(isDetectionArea) &&
  Array.isArray(camera.excludedAreaNotes) &&
  camera.excludedAreaNotes.every((note) => typeof note === "string") &&
  (typeof camera.detectionEnabled === "undefined" ||
    typeof camera.detectionEnabled === "boolean");

// validate the editable camera document
export const isCameraDetectionAreasConfig = (
  payload: unknown
): payload is CameraDetectionAreasConfig => {
  // document shape guard
  if (
    !isObject(payload) ||
    payload.schemaVersion !== 2 ||
    payload.coordinateSpace !== "normalized-image" ||
    payload.origin !== "top-left" ||
    !Array.isArray(payload.cameraIds) ||
    !payload.cameraIds.every((cameraId) => typeof cameraId === "string") ||
    !Array.isArray(payload.reviewedCameraIds) ||
    !payload.reviewedCameraIds.every(
      (cameraId) => typeof cameraId === "string"
    ) ||
    !isObject(payload.cameras)
  ) {
    return false;
  }
  // camera inventory guard
  return payload.cameraIds.every(
    (cameraId) =>
      cameraId in payload.cameras &&
      isDetectionCamera(payload.cameras[cameraId])
  );
};

// index immutable benchmark frames
const getBenchmarkFrames = async (
  manifestFile: string
): Promise<Map<string, BenchmarkFrame>> => {
  const manifest = await readJson<BenchmarkManifest>(manifestFile);
  return new Map(manifest.frames.map((frame) => [frame.frameId, frame]));
};

// validate benchmark ground truth
const validateBenchmarkLabels = async (
  payload: unknown,
  annotationFile: string,
  manifestFile: string
): Promise<void> => {
  // labels envelope guard
  if (!isObject(payload) || !isObject(payload.frames)) {
    throw new Error("Expected benchmark labels with a frames object");
  }
  const [config, frames] = await Promise.all([
    readJson<CameraDetectionAreasConfig>(annotationFile),
    getBenchmarkFrames(manifestFile),
  ]);
  // frame label validation pass
  for (const [frameId, value] of Object.entries(payload.frames)) {
    const frame = frames.get(frameId);
    // known frame guard
    if (!frame || !isObject(value)) {
      throw new Error(`Invalid benchmark frame: ${frameId}`);
    }
    // camera identity guard
    if (value.cameraId !== frame.cameraId || !isObject(value.areaStates)) {
      throw new Error(`Invalid labels for benchmark frame: ${frameId}`);
    }
    const areaIds = new Set(
      config.cameras[frame.cameraId]?.allowedAreas.map(({ id }) => id) ?? []
    );
    // polygon label validation pass
    for (const [areaId, state] of Object.entries(value.areaStates)) {
      // polygon truth guard
      if (
        !areaIds.has(areaId) ||
        typeof state !== "string" ||
        !OCCUPANCY_STATES.has(state as CameraAreaOccupancyState)
      ) {
        throw new Error(`Invalid benchmark polygon label: ${areaId}`);
      }
    }
    // notes guard
    if (typeof value.notes !== "string" || value.notes.length > 1000) {
      throw new Error(`Invalid notes for benchmark frame: ${frameId}`);
    }
  }
};

// fetch with a bounded timeout
const fetchWithin = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<globalThis.Response> =>
  await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

// create standalone debugger pages
export const createCameraDetectionDebuggerPageRouter = ({
  debuggerHtmlFile = defaultDebuggerHtmlFile,
}: CameraDetectionDebuggerPageOptions = {}): Router => {
  const router = Router();
  // serve tool page routes
  router.get(
    ["/", "/editor", "/benchmarks", "/capture"],
    async (_request, response) => {
      response.set("Cache-Control", "no-store");
      response.type("text/html").end(await readFile(debuggerHtmlFile));
    }
  );
  return router;
};

// create the development-only debugger routes
export const createCameraDetectionDebuggerRouter = ({
  detectorUrl = getCameraDetectionDebuggerDetectorUrl(),
  fetchImpl = fetch,
  paths: pathOverrides,
  rateLimiter = createCameraDetectionDebuggerRateLimiter(),
}: CameraDetectionDebuggerOptions = {}): Router => {
  const paths = { ...defaultPaths, ...pathOverrides };
  const router = Router();

  // protect repository and detector work
  router.use(rateLimiter);

  // serve the editable camera JSON
  router.get("/camera-detection-areas.json", async (_request, response) => {
    response.type("application/json").end(await readFile(paths.annotationFile));
  });

  // serve canonical camera display overrides
  router.get("/camera-display-overrides.json", async (_request, response) => {
    response
      .type("application/json")
      .end(await readFile(paths.cameraOverridesFile));
  });

  // persist the editable camera JSON
  router.post("/save-annotations", async (request, response) => {
    // config shape guard
    if (!isCameraDetectionAreasConfig(request.body)) {
      sendRawJson(response, 400, { error: "Invalid camera detection config" });
      return;
    }
    const payload = structuredClone(
      request.body
    ) as CameraDetectionAreasConfig & {
      source?: Record<string, unknown>;
    };
    payload.source = isObject(payload.source) ? payload.source : {};
    payload.source.savedBy = "ferry-fyi-camera-detection-debugger";
    await writeJson(paths.annotationFile, payload);
    sendRawJson(response, 200, { file: paths.annotationFile, ok: true });
  });

  // serve the benchmark manifest
  router.get("/camera-benchmark.json", async (_request, response) => {
    response
      .type("application/json")
      .end(await readFile(paths.benchmarkManifestFile));
  });

  // serve the benchmark labels
  router.get("/camera-benchmark-labels.json", async (_request, response) => {
    response
      .type("application/json")
      .end(await readFile(paths.benchmarkLabelsFile));
  });

  // list raw capture runs and file totals
  router.get("/capture-runs", async (_request, response) => {
    sendRawJson(response, 200, await listCameraCaptureRuns(paths.captureRoot));
  });

  // start one bounded background capture run
  router.post("/capture-runs", async (request, response) => {
    try {
      const captureRequest = await validateCameraCaptureRunRequest(
        request.body,
        paths.annotationFile
      );
      sendRawJson(
        response,
        202,
        await startCameraCaptureRun(captureRequest, paths)
      );
    } catch (error) {
      sendRawJson(response, 400, {
        error: error instanceof Error ? error.message : "Capture start failed",
      });
    }
  });

  // gracefully stop one background capture run
  router.post("/capture-runs/:sessionId/stop", async (request, response) => {
    try {
      await stopCameraCaptureRun(paths.captureRoot, request.params.sessionId);
      sendRawJson(response, 202, { ok: true });
    } catch (error) {
      sendRawJson(response, 400, {
        error: error instanceof Error ? error.message : "Capture stop failed",
      });
    }
  });

  // copy unique raw frames into the labeling benchmark
  router.post("/capture-runs/:sessionId/import", async (request, response) => {
    try {
      const importedFrames = await importCameraCaptureRun(
        paths,
        request.params.sessionId
      );
      sendRawJson(response, 200, { importedFrames, ok: true });
    } catch (error) {
      sendRawJson(response, 400, {
        error: error instanceof Error ? error.message : "Capture import failed",
      });
    }
  });

  // remove terminal raw capture files
  router.delete("/capture-runs/:sessionId", async (request, response) => {
    try {
      await deleteCameraCaptureRun(paths.captureRoot, request.params.sessionId);
      sendRawJson(response, 200, { ok: true });
    } catch (error) {
      sendRawJson(response, 400, {
        error: error instanceof Error ? error.message : "Capture delete failed",
      });
    }
  });

  // serve a selected immutable benchmark frame
  router.get("/camera-benchmark-frame/:filename", async (request, response) => {
    const frames = await getBenchmarkFrames(paths.benchmarkManifestFile);
    const frame = [...frames.values()].find(
      ({ file }) => path.basename(file) === request.params.filename
    );
    // known frame guard
    if (!frame) {
      sendRawJson(response, 404, { error: "Unknown benchmark frame" });
      return;
    }
    response
      .set("Cache-Control", "no-store")
      .type(frame.contentType)
      .end(await readFile(path.join(paths.benchmarkRoot, frame.file)));
  });

  // persist benchmark ground truth
  router.post("/save-benchmark-labels", async (request, response) => {
    try {
      await validateBenchmarkLabels(
        request.body,
        paths.annotationFile,
        paths.benchmarkManifestFile
      );
    } catch (error) {
      sendRawJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid labels",
      });
      return;
    }
    const payload = structuredClone(request.body) as Record<string, unknown>;
    payload.schemaVersion = 1;
    payload.updatedAt = new Date().toISOString();
    await writeJson(paths.benchmarkLabelsFile, payload);
    sendRawJson(response, 200, {
      file: paths.benchmarkLabelsFile,
      ok: true,
    });
  });

  // proxy the displayed frame to the local detector
  router.post("/detect-current-image", async (request, response) => {
    try {
      // request shape guard
      if (!isObject(request.body)) {
        throw new Error("Expected a detector request object");
      }
      let image: ArrayBuffer;
      let contentType: string;
      const { frameId } = request.body;
      // stored frame branch
      if (typeof frameId === "string") {
        const frame = (
          await getBenchmarkFrames(paths.benchmarkManifestFile)
        ).get(frameId);
        // known frame guard
        if (!frame) {
          throw new Error("Unknown benchmark frameId");
        }
        image = toArrayBuffer(
          await readFile(path.join(paths.benchmarkRoot, frame.file))
        );
        ({ contentType } = frame);
      } else {
        const imageUrl = new URL(String(request.body.imageUrl ?? ""));
        // trusted image guard
        if (
          imageUrl.protocol !== "https:" ||
          imageUrl.hostname !== CAMERA_IMAGE_HOST ||
          imageUrl.username ||
          imageUrl.password
        ) {
          throw new Error("Expected an HTTPS WSDOT camera imageUrl");
        }
        const imageResponse = await fetchWithin(
          fetchImpl,
          imageUrl.href,
          undefined,
          20_000
        );
        // image response guard
        if (!imageResponse.ok) {
          throw new Error(`Camera image HTTP ${imageResponse.status}`);
        }
        image = await imageResponse.arrayBuffer();
        contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
      }
      const detectorResponse = await fetchWithin(
        fetchImpl,
        detectorUrl,
        {
          body: image,
          headers: {
            "Content-Type": contentType,
            "X-Detection-Areas": JSON.stringify({
              allowedAreas: request.body.allowedAreas ?? [],
              excludedAreas: request.body.excludedAreas ?? [],
            }),
          },
          method: "POST",
        },
        60_000
      );
      // detector response guard
      if (!detectorResponse.ok) {
        throw new Error(`Detector HTTP ${detectorResponse.status}`);
      }
      const detectorContentType =
        detectorResponse.headers.get("content-type") ?? "";
      // upstream payload guard
      if (!detectorContentType.includes("application/json")) {
        throw new Error(
          `Detector returned ${detectorContentType || "a non-JSON response"}`
        );
      }
      sendRawJson(response, 200, await detectorResponse.json());
    } catch (error) {
      // preserve detector diagnostics
      logger.error("Camera detection debugger request failed", {
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      sendRawJson(response, 502, { error: "Detector unavailable" });
    }
  });

  return router;
};
