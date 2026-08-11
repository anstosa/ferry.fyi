import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("heroku-logger", () => ({ default: logs }));

import {
  createCameraDetectionDebuggerPageRouter,
  createCameraDetectionDebuggerRateLimiter,
  createCameraDetectionDebuggerRouter,
  getCameraDetectionDebuggerDetectorUrl,
} from "~/controllers/api/cameraDetectionDebugger";
import { wrapApiResponse } from "~/lib/httpApiPolicy";

const cameraId = "camera-one";
const areaId = "queue-one";
const baseConfig = {
  cameraIds: [cameraId],
  cameras: {
    [cameraId]: {
      allowedAreas: [
        {
          id: areaId,
          label: "Queue one",
          polygon: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          type: "queue_lane",
        },
      ],
      detectionEnabled: true,
      displayName: "Test camera",
      excludedAreaNotes: [],
      excludedAreas: [],
      frameSize: { height: 100, width: 100 },
      imageUrl: "https://images.wsdot.wa.gov/test.jpg",
      requiresDaylightReview: false,
      reviewed: true,
      terminal: "Test terminal",
      terminalId: "terminal-one",
      title: "Test camera",
    },
  },
  coordinateSpace: "normalized-image",
  origin: "top-left",
  pointFormat: ["x", "y"],
  reviewedCameraIds: [cameraId],
  schemaVersion: 2,
  status: "manual-partial-review",
};

interface FixturePaths {
  annotationFile: string;
  benchmarkLabelsFile: string;
  benchmarkManifestFile: string;
  benchmarkRoot: string;
  cameraOverridesFile: string;
  captureRoot: string;
  debuggerHtmlFile: string;
  recorderScript: string;
  root: string;
}

// create an isolated repository fixture
const createFixture = async (): Promise<FixturePaths> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferry-camera-debugger-"));
  const paths = {
    annotationFile: path.join(root, "camera-detection-areas.json"),
    benchmarkLabelsFile: path.join(root, "labels.json"),
    benchmarkManifestFile: path.join(root, "manifest.json"),
    benchmarkRoot: root,
    cameraOverridesFile: path.join(root, "cameras.json"),
    captureRoot: path.join(root, "captures"),
    debuggerHtmlFile: path.join(root, "index.html"),
    recorderScript: path.join(root, "recorder.py"),
    root,
  };
  await mkdir(paths.captureRoot);
  await Promise.all([
    writeFile(paths.annotationFile, JSON.stringify(baseConfig)),
    writeFile(
      paths.cameraOverridesFile,
      JSON.stringify({ [cameraId]: { title: "Custom camera" } })
    ),
    writeFile(
      paths.benchmarkLabelsFile,
      JSON.stringify({ frames: {}, schemaVersion: 1, updatedAt: null })
    ),
    writeFile(
      paths.benchmarkManifestFile,
      JSON.stringify({
        frames: [
          {
            cameraId,
            contentType: "image/jpeg",
            file: "frame.jpg",
            frameId: "control-one",
          },
        ],
      })
    ),
    writeFile(paths.debuggerHtmlFile, "<!doctype html><title>debugger</title>"),
    writeFile(paths.recorderScript, "#!/usr/bin/env python3\n"),
    writeFile(path.join(root, "frame.jpg"), "frame-bytes"),
  ]);
  return paths;
};

// create the isolated Express surface
const createTestApp = (
  paths: FixturePaths,
  fetchImpl: typeof fetch = fetch
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    "/camera-detection",
    createCameraDetectionDebuggerRouter({
      detectorUrl: "http://detector.test/detect",
      fetchImpl,
      paths,
    })
  );
  return app;
};

describe("camera detection development debugger", () => {
  let paths: FixturePaths;

  // prepare a fresh JSON fixture
  beforeEach(async () => {
    paths = await createFixture();
  });

  // restore spies
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(paths.root, { force: true, recursive: true });
  });

  // container endpoint contract
  it("uses the container detector endpoint when no debugger override exists", () => {
    vi.stubEnv("FERRY_DETECTOR_URL", "");
    vi.stubEnv("CAR_DETECTION_ENDPOINT", "http://detector:8000/detect");

    expect(getCameraDetectionDebuggerDetectorUrl()).toBe(
      "http://detector:8000/detect"
    );
  });

  // standalone document contract
  it("serves standalone editor and benchmark pages", async () => {
    const app = express();
    app.use(
      "/dev/camera-detection",
      createCameraDetectionDebuggerPageRouter({
        debuggerHtmlFile: paths.debuggerHtmlFile,
      })
    );

    const editorResponse = await request(app).get("/dev/camera-detection");
    expect(editorResponse.status).toBe(200);
    expect(editorResponse.headers["cache-control"]).toBe("no-store");
    expect(editorResponse.text).toContain("<title>debugger</title>");

    const benchmarkResponse = await request(app).get(
      "/dev/camera-detection/benchmarks"
    );
    expect(benchmarkResponse.status).toBe(200);
    expect(benchmarkResponse.text).toContain("<title>debugger</title>");
  });

  // repository read contract
  it("serves repository JSON without an API document page", async () => {
    const app = createTestApp(paths);

    const debuggerResponse = await request(app).get("/camera-detection");
    expect(debuggerResponse.status).toBe(404);

    const configResponse = await request(app).get(
      "/camera-detection/camera-detection-areas.json"
    );
    expect(configResponse.status).toBe(200);
    expect(configResponse.body.cameraIds).toEqual([cameraId]);

    const overridesResponse = await request(app).get(
      "/camera-detection/camera-display-overrides.json"
    );
    expect(overridesResponse.status).toBe(200);
    expect(overridesResponse.body[cameraId].title).toBe("Custom camera");
  });

  // debugger rate-limit contract
  it("rate-limits repository and detector work", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.use(
      "/camera-detection",
      createCameraDetectionDebuggerRouter({
        paths,
        rateLimiter: createCameraDetectionDebuggerRateLimiter({ limit: 1 }),
      })
    );

    await request(app)
      .get("/camera-detection/camera-detection-areas.json")
      .expect(200);
    const limitedResponse = await request(app)
      .get("/camera-detection/camera-display-overrides.json")
      .expect(429);

    expect(limitedResponse.headers["ratelimit-policy"]).toContain("1;");
    expect(limitedResponse.body).toEqual({ error: "Rate limit exceeded" });
    expect(limitedResponse.body).not.toHaveProperty("body");
  });

  // repository save contract
  it("atomically saves valid camera edits back to JSON", async () => {
    const app = createTestApp(paths);
    const payload = structuredClone(baseConfig);
    payload.cameras[cameraId].displayName = "Updated camera";

    const response = await request(app)
      .post("/camera-detection/save-annotations")
      .send(payload);

    expect(response.status).toBe(200);
    const saved = JSON.parse(await readFile(paths.annotationFile, "utf8"));
    expect(saved.cameras[cameraId].displayName).toBe("Updated camera");
    expect(saved.source.savedBy).toBe("ferry-fyi-camera-detection-debugger");
  });

  // invalid config guard
  it("rejects malformed normalized polygons without changing JSON", async () => {
    const app = createTestApp(paths);
    const original = await readFile(paths.annotationFile, "utf8");
    const payload = structuredClone(baseConfig);
    payload.cameras[cameraId].allowedAreas[0].polygon[0] = [2, 0];

    const response = await request(app)
      .post("/camera-detection/save-annotations")
      .send(payload);

    expect(response.status).toBe(400);
    expect(await readFile(paths.annotationFile, "utf8")).toBe(original);
  });

  // ground-truth save contract
  it("validates and saves benchmark labels", async () => {
    const app = createTestApp(paths);
    const response = await request(app)
      .post("/camera-detection/save-benchmark-labels")
      .send({
        frames: {
          "control-one": {
            areaStates: { [areaId]: "empty" },
            cameraId,
            notes: "negative control",
          },
        },
      });

    expect(response.status).toBe(200);
    const saved = JSON.parse(await readFile(paths.benchmarkLabelsFile, "utf8"));
    expect(saved.frames["control-one"].areaStates[areaId]).toBe("empty");
    expect(saved.updatedAt).toEqual(expect.any(String));
  });

  // raw capture lifecycle contract
  it("lists, imports, and deletes completed capture runs", async () => {
    const app = createTestApp(paths);
    const sessionId = "capture-test-run";
    const runRoot = path.join(paths.captureRoot, sessionId);
    await mkdir(path.join(runRoot, "frames"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(runRoot, "session.json"),
        JSON.stringify({
          cameraIds: [cameraId],
          duplicateFrames: 0,
          failedFrames: 0,
          imageLimit: 1,
          intervalSeconds: 600,
          roundsCompleted: 1,
          sessionId,
          startedAt: "2026-08-08T12:00:00.000Z",
          status: "completed",
          storedFrames: 1,
        })
      ),
      writeFile(
        path.join(runRoot, "manifest.jsonl"),
        `${JSON.stringify({
          cameraId,
          cameraName: "Test camera",
          capturedAt: "2026-08-08T12:00:00.000Z",
          contentType: "image/jpeg",
          file: "frames/captured.jpg",
          frameSize: { height: 100, width: 100 },
          sha256: "capture-sha",
          sourceImageUrl: "https://images.wsdot.wa.gov/test.jpg",
          status: "stored",
        })}\n`
      ),
      writeFile(path.join(runRoot, "frames/captured.jpg"), "captured-frame"),
    ]);

    const listResponse = await request(app).get(
      "/camera-detection/capture-runs"
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({
      sessionId,
      status: "completed",
      storedFrames: 1,
    });

    const importResponse = await request(app).post(
      `/camera-detection/capture-runs/${sessionId}/import`
    );
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.importedFrames).toBe(1);
    const manifest = JSON.parse(
      await readFile(paths.benchmarkManifestFile, "utf8")
    );
    const importedFrame = manifest.frames.find(
      (frame: { sha256?: string }) => frame.sha256 === "capture-sha"
    );
    expect(importedFrame).toMatchObject({ cameraId, role: "test" });
    // imported frame guard
    if (!importedFrame) {
      throw new Error("Expected an imported benchmark frame");
    }
    expect(
      await readFile(
        path.join(paths.benchmarkRoot, String(importedFrame.file)),
        "utf8"
      )
    ).toBe("captured-frame");
    const repeatedImportResponse = await request(app).post(
      `/camera-detection/capture-runs/${sessionId}/import`
    );
    expect(repeatedImportResponse.status).toBe(200);
    expect(repeatedImportResponse.body.importedFrames).toBe(0);

    const deleteResponse = await request(app).delete(
      `/camera-detection/capture-runs/${sessionId}`
    );
    expect(deleteResponse.status).toBe(200);
    await expect(access(paths.captureRoot)).resolves.toBeUndefined();
    await expect(access(runRoot)).rejects.toThrow();
  });

  // capture request authorization contract
  it("rejects cameras that are not enabled for detection", async () => {
    const app = createTestApp(paths);
    const response = await request(app)
      .post("/camera-detection/capture-runs")
      .send({
        cameraIds: ["unknown-camera"],
        durationSeconds: 600,
        imageLimit: 2,
        intervalSeconds: 600,
        sessionId: "capture-invalid-camera",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not enabled");
  });

  // detached recorder launch contract
  it("starts bounded capture runs for eligible cameras", async () => {
    const app = createTestApp(paths);
    const response = await request(app)
      .post("/camera-detection/capture-runs")
      .send({
        cameraIds: [cameraId],
        durationSeconds: 600,
        imageLimit: 1,
        intervalSeconds: 600,
        sessionId: "capture-valid-camera",
      });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      cameraIds: [cameraId],
      imageLimit: 1,
      sessionId: "capture-valid-camera",
      status: "starting",
    });
    const requestPayload = JSON.parse(
      await readFile(
        path.join(paths.captureRoot, "capture-valid-camera/request.json"),
        "utf8"
      )
    );
    expect(requestPayload.cameraIds).toEqual([cameraId]);
  });

  // stored-frame detector contract
  it("proxies immutable benchmark bytes to the configured detector", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "Content-Type": "image/jpeg",
      });
      return Promise.resolve(
        new Response(JSON.stringify({ detections: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      );
    }) as unknown as typeof fetch;
    const app = createTestApp(paths, fetchImpl);

    const response = await request(app)
      .post("/camera-detection/detect-current-image")
      .send({
        allowedAreas: baseConfig.cameras[cameraId].allowedAreas,
        excludedAreas: [],
        frameId: "control-one",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ detections: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://detector.test/detect",
      expect.any(Object)
    );
  });

  // upstream content-type contract
  it("reports non-JSON detector responses without leaking parser errors", async () => {
    const fetchImpl = vi.fn(() => {
      return Promise.resolve(
        new Response("<!DOCTYPE html><title>wrong service</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: 200,
        })
      );
    }) as unknown as typeof fetch;
    const app = createTestApp(paths, fetchImpl);

    const response = await request(app)
      .post("/camera-detection/detect-current-image")
      .send({ frameId: "control-one" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Detector unavailable",
    });
  });

  // raw debugger response contract
  it("keeps detector errors outside the wrapped API envelope", async () => {
    // simulate tainted upstream failure
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.reject(new Error("<img src=x onerror=alert(1)>"))
    );
    const app = express();
    app.use(express.json());
    app.use(wrapApiResponse);
    app.use(
      "/camera-detection",
      createCameraDetectionDebuggerRouter({
        detectorUrl: "http://detector.test/detect",
        fetchImpl,
        paths,
      })
    );

    const response = await request(app)
      .post("/camera-detection/detect-current-image")
      .send({ frameId: "control-one" });

    expect(response.status).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ error: "Detector unavailable" });
    expect(response.body).not.toHaveProperty("body");
    expect(logs.error).toHaveBeenCalledWith(
      "Camera detection debugger request failed",
      expect.objectContaining({
        error: "<img src=x onerror=alert(1)>",
        stack: expect.any(String),
      })
    );
  });
});
