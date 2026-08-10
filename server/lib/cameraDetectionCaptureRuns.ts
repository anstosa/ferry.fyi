import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { CameraDetectionAreasConfig } from "shared/contracts/cameraDetection";
import { isObject } from "shared/lib/objects";

const CAPTURE_RUN_ID = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);

export interface CameraCaptureRunPaths {
  annotationFile: string;
  benchmarkManifestFile: string;
  benchmarkRoot: string;
  captureRoot: string;
  recorderScript: string;
}

export interface CameraCaptureRunRequest {
  cameraIds: string[];
  durationSeconds: number;
  imageLimit: number;
  intervalSeconds: number;
  sessionId: string;
}

interface CaptureRecord {
  cameraId: string;
  cameraName: string;
  capturedAt: string;
  contentType: string;
  file: string;
  frameSize: { height: number; width: number };
  sha256: string;
  sourceImageUrl: string;
  status: string;
}

interface CaptureSession extends Record<string, unknown> {
  cameraIds?: string[];
  duplicateFrames?: number;
  failedFrames?: number;
  importedFrames?: number;
  intervalSeconds?: number;
  imageLimit?: number;
  roundsCompleted?: number;
  sessionId?: string;
  startedAt?: string;
  status?: string;
  storedFrames?: number;
}

interface BenchmarkManifest extends Record<string, unknown> {
  frames: Array<Record<string, unknown>>;
}

export interface CameraCaptureRunSummary {
  cameraIds: string[];
  createdAt: string | null;
  duplicateFrames: number;
  failedFrames: number;
  imageLimit: number;
  importedFrames: number;
  intervalSeconds: number;
  logTail: string;
  roundsCompleted: number;
  sessionId: string;
  status: string;
  storedBytes: number;
  storedFrames: number;
}

// parse one JSON file when present
const readOptionalJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    // missing file guard
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

// validate one bounded integer
const boundedInteger = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number => {
  // integer boundary guard
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
};

// validate one capture request
export const validateCameraCaptureRunRequest = async (
  payload: unknown,
  annotationFile: string
): Promise<CameraCaptureRunRequest> => {
  // request envelope guard
  if (!isObject(payload)) {
    throw new Error("Expected a capture run request");
  }
  const sessionId = String(payload.sessionId ?? "")
    .trim()
    .toLowerCase();
  // session name guard
  if (!CAPTURE_RUN_ID.test(sessionId)) {
    throw new Error(
      "Session id must use 3-64 lowercase letters, numbers, or hyphens"
    );
  }
  // camera list guard
  if (
    !Array.isArray(payload.cameraIds) ||
    payload.cameraIds.length === 0 ||
    !payload.cameraIds.every((cameraId) => typeof cameraId === "string")
  ) {
    throw new Error("Select at least one camera");
  }
  const cameraIds = [...new Set(payload.cameraIds)];
  const imageLimit = boundedInteger(
    payload.imageLimit,
    "Image limit",
    1,
    10_000
  );
  const durationSeconds = boundedInteger(
    payload.durationSeconds,
    "Time limit",
    0,
    31 * 24 * 60 * 60
  );
  const intervalSeconds = boundedInteger(
    payload.intervalSeconds,
    "Interval",
    1,
    24 * 60 * 60
  );
  // multi-image time guard
  if (imageLimit > 1 && durationSeconds < 1) {
    throw new Error("Time limit must be positive for multiple images");
  }
  // total file ceiling guard
  if (cameraIds.length * imageLimit > 100_000) {
    throw new Error("Capture run exceeds the 100,000-image safety limit");
  }
  const config = JSON.parse(
    await readFile(annotationFile, "utf8")
  ) as CameraDetectionAreasConfig;
  // eligible camera pass
  for (const cameraId of cameraIds) {
    const camera = config.cameras[cameraId];
    // configured camera guard
    if (
      !camera ||
      !camera.reviewed ||
      camera.detectionEnabled === false ||
      camera.allowedAreas.length === 0
    ) {
      throw new Error(`Camera is not enabled for detection: ${cameraId}`);
    }
  }
  return {
    cameraIds,
    durationSeconds,
    imageLimit,
    intervalSeconds,
    sessionId,
  };
};

// measure stored capture bytes
const getStoredBytes = async (framesDirectory: string): Promise<number> => {
  try {
    const entries = await readdir(framesDirectory, { withFileTypes: true });
    let total = 0;
    // frame size pass
    for (const entry of entries) {
      // regular file guard
      if (entry.isFile()) {
        total += (await stat(path.join(framesDirectory, entry.name))).size;
      }
    }
    return total;
  } catch (error) {
    // missing directory guard
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
};

// read a bounded log tail
const getLogTail = async (logFile: string): Promise<string> => {
  try {
    const contents = await readFile(logFile, "utf8");
    return contents.slice(-2_000);
  } catch (error) {
    // missing log guard
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
};

// summarize one capture directory
const summarizeCaptureRun = async (
  captureRoot: string,
  sessionId: string
): Promise<CameraCaptureRunSummary> => {
  const runDirectory = path.join(captureRoot, sessionId);
  const [request, session, storedBytes, logTail] = await Promise.all([
    readOptionalJson<CameraCaptureRunRequest>(
      path.join(runDirectory, "request.json")
    ),
    readOptionalJson<CaptureSession>(path.join(runDirectory, "session.json")),
    getStoredBytes(path.join(runDirectory, "frames")),
    getLogTail(path.join(runDirectory, "capture.log")),
  ]);
  return {
    cameraIds: session?.cameraIds ?? request?.cameraIds ?? [],
    createdAt: session?.startedAt ?? null,
    duplicateFrames: session?.duplicateFrames ?? 0,
    failedFrames: session?.failedFrames ?? 0,
    imageLimit: session?.imageLimit ?? request?.imageLimit ?? 0,
    importedFrames: session?.importedFrames ?? 0,
    intervalSeconds: session?.intervalSeconds ?? request?.intervalSeconds ?? 0,
    logTail,
    roundsCompleted: session?.roundsCompleted ?? 0,
    sessionId,
    status: session?.status ?? "starting",
    storedBytes,
    storedFrames: session?.storedFrames ?? 0,
  };
};

// list capture sessions newest first
export const listCameraCaptureRuns = async (
  captureRoot: string
): Promise<CameraCaptureRunSummary[]> => {
  await mkdir(captureRoot, { recursive: true });
  const entries = await readdir(captureRoot, { withFileTypes: true });
  const runIds = entries
    .filter((entry) => entry.isDirectory() && CAPTURE_RUN_ID.test(entry.name))
    .map((entry) => entry.name);
  const runs = await Promise.all(
    runIds.map((sessionId) => summarizeCaptureRun(captureRoot, sessionId))
  );
  return runs.sort((left, right) =>
    String(right.createdAt ?? right.sessionId).localeCompare(
      String(left.createdAt ?? left.sessionId)
    )
  );
};

// start one detached recorder process
export const startCameraCaptureRun = async (
  request: CameraCaptureRunRequest,
  paths: CameraCaptureRunPaths
): Promise<CameraCaptureRunSummary> => {
  const runDirectory = path.join(paths.captureRoot, request.sessionId);
  await mkdir(paths.captureRoot, { recursive: true });
  await mkdir(runDirectory);
  await writeFile(
    path.join(runDirectory, "request.json"),
    `${JSON.stringify(request, null, 2)}\n`,
    "utf8"
  );
  const stopAt = new Date(
    Date.now() + request.durationSeconds * 1_000
  ).toISOString();
  const args = [
    paths.recorderScript,
    "--camera-config",
    paths.annotationFile,
    "--image-limit",
    String(request.imageLimit),
    "--interval-seconds",
    String(request.intervalSeconds),
    "--output-dir",
    runDirectory,
    "--session-id",
    request.sessionId,
  ];
  // single-image branch
  if (request.imageLimit === 1) {
    args.push("--once");
  } else {
    args.push("--stop-at", stopAt);
  }
  // camera argument pass
  for (const cameraId of request.cameraIds) {
    args.push("--camera-id", cameraId);
  }
  const logFile = path.join(runDirectory, "capture.log");
  const logDescriptor = openSync(logFile, "a");
  try {
    const child = spawn("python3", args, {
      cwd: path.dirname(paths.recorderScript),
      detached: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  return await summarizeCaptureRun(paths.captureRoot, request.sessionId);
};

// validate a capture directory identifier
const captureRunDirectory = (
  captureRoot: string,
  sessionId: string
): string => {
  // identifier guard
  if (!CAPTURE_RUN_ID.test(sessionId)) {
    throw new Error("Invalid capture session id");
  }
  return path.join(captureRoot, sessionId);
};

// request a graceful recorder stop
export const stopCameraCaptureRun = async (
  captureRoot: string,
  sessionId: string
): Promise<void> => {
  const runDirectory = captureRunDirectory(captureRoot, sessionId);
  await access(runDirectory);
  await writeFile(path.join(runDirectory, ".stop-requested"), "stop\n", "utf8");
};

// remove one terminal raw capture session
export const deleteCameraCaptureRun = async (
  captureRoot: string,
  sessionId: string
): Promise<void> => {
  const runDirectory = captureRunDirectory(captureRoot, sessionId);
  const session = await readOptionalJson<CaptureSession>(
    path.join(runDirectory, "session.json")
  );
  // active run guard
  if (!session || !TERMINAL_STATUSES.has(String(session.status))) {
    throw new Error("Stop the capture run before deleting its files");
  }
  await rm(runDirectory, { recursive: true });
};

// read durable stored capture records
const readCaptureRecords = async (
  manifestFile: string
): Promise<CaptureRecord[]> => {
  const contents = await readFile(manifestFile, "utf8");
  const records: CaptureRecord[] = [];
  // manifest row pass
  for (const line of contents.split("\n")) {
    // stored row guard
    if (!line.trim()) {
      continue;
    }
    const record = JSON.parse(line) as CaptureRecord;
    // usable frame guard
    if (
      record.status === "stored" &&
      typeof record.file === "string" &&
      record.file === `frames/${path.basename(record.file)}`
    ) {
      records.push(record);
    }
  }
  return records;
};

// build one stable benchmark identifier
const captureFrameId = (sessionId: string, record: CaptureRecord): string =>
  `${sessionId}-${record.cameraId}-${record.capturedAt}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// copy raw frames into the canonical labeling set
export const importCameraCaptureRun = async (
  paths: CameraCaptureRunPaths,
  sessionId: string
): Promise<number> => {
  const runDirectory = captureRunDirectory(paths.captureRoot, sessionId);
  const sessionFile = path.join(runDirectory, "session.json");
  const session = await readOptionalJson<CaptureSession>(sessionFile);
  // terminal run guard
  if (!session || !TERMINAL_STATUSES.has(String(session.status))) {
    throw new Error("Stop the capture run before adding frames to labeling");
  }
  const [records, manifest] = await Promise.all([
    readCaptureRecords(path.join(runDirectory, "manifest.jsonl")),
    readOptionalJson<BenchmarkManifest>(paths.benchmarkManifestFile),
  ]);
  // benchmark manifest guard
  if (!manifest || !Array.isArray(manifest.frames)) {
    throw new Error("Benchmark manifest is unavailable");
  }
  const existingKeys = new Set(
    manifest.frames.map((frame) => `${frame.cameraId}:${frame.sha256}`)
  );
  const benchmarkFramesDirectory = path.join(paths.benchmarkRoot, "frames");
  await mkdir(benchmarkFramesDirectory, { recursive: true });
  let importedFrames = 0;
  // capture promotion pass
  for (const record of records) {
    const key = `${record.cameraId}:${record.sha256}`;
    // canonical duplicate guard
    if (existingKeys.has(key)) {
      continue;
    }
    const extension = path.extname(record.file).toLowerCase() || ".jpg";
    const frameId = captureFrameId(sessionId, record);
    const fileName = `${frameId}${extension}`;
    const sourceFile = path.join(runDirectory, record.file);
    const destinationFile = path.join(benchmarkFramesDirectory, fileName);
    // interrupted import recovery
    if (!existsSync(destinationFile)) {
      await copyFile(sourceFile, destinationFile, constants.COPYFILE_EXCL);
    }
    manifest.frames.push({
      cameraId: record.cameraId,
      cameraName: record.cameraName,
      capturedAt: record.capturedAt,
      contentType: record.contentType,
      file: `frames/${fileName}`,
      frameId,
      frameSize: record.frameSize,
      role: "test",
      sha256: record.sha256,
      sourceImageUrl: record.sourceImageUrl,
    });
    existingKeys.add(key);
    importedFrames += 1;
  }
  const temporaryManifest = `${paths.benchmarkManifestFile}.${process.pid}.tmp`;
  await writeFile(
    temporaryManifest,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryManifest, paths.benchmarkManifestFile);
  session.importedFrames = Number(session.importedFrames ?? 0) + importedFrames;
  session.importedAt = new Date().toISOString();
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return importedFrames;
};
