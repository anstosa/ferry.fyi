import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cameraRouter } from "../../server/controllers/api/cameras";
import {
  CameraLineDetectionService,
  getLineDetectionCameraConfig,
  getLineDetectionCameraIds,
} from "~/lib/cameraLineDetection";
import type { CameraDetectionPoint } from "../../shared/contracts/cameraDetection";
import { isPointInPolygon } from "../../shared/lib/cameraDetection";

// find stable interior point
const findInteriorPoint = (
  polygon: CameraDetectionPoint[]
): CameraDetectionPoint => {
  // grid x scan
  for (let xStep = 1; xStep < 10; xStep += 1) {
    // grid y scan
    for (let yStep = 1; yStep < 10; yStep += 1) {
      const point: CameraDetectionPoint = [xStep / 10, yStep / 10];
      // interior guard
      if (isPointInPolygon(point, polygon)) {
        return point;
      }
    }
  }
  throw new Error("No interior point found");
};

// build detection response image
const imageResponse = (): Response =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/jpeg" },
    status: 200,
  });

// camera line detection api
describe("camera line detection API", () => {
  // build test app
  const buildApp = (): express.Express => {
    const app = express();
    app.use("/api/cameras", cameraRouter);
    return app;
  };

  // invalid id guard
  it("rejects invalid camera ids before service work", async () => {
    const app = buildApp();

    const response = await request(app)
      .get("/api/cameras/line-detection?ids=9164,bad-camera,bad-camera")
      .expect(400);

    expect(response.body).toEqual({
      error: "Invalid camera ids",
      invalidCameraIds: ["bad-camera"],
    });
  });

  // plain public cache guard
  it("uses cached-only options for plain public line detection requests", async () => {
    const getCameraLineDetections = vi.fn().mockResolvedValue({
      "9164": {
        cameraId: "9164",
        error: "No cached line detection status",
      },
    });

    vi.resetModules();
    vi.doMock("~/lib/cameraLineDetection", () => {
      return {
        getCameraLineDetections,
        getLineDetectionCameraIds: () => ["9164"],
      };
    });

    try {
      const { cameraRouter: mockedCameraRouter } = await import(
        "../../server/controllers/api/cameras"
      );
      const app = express();
      app.use("/api/cameras", mockedCameraRouter);

      await request(app).get("/api/cameras/line-detection?ids=9164").expect(200);

      expect(getCameraLineDetections).toHaveBeenCalledWith(["9164"], {
        includeDetections: false,
        refresh: false,
      });
    } finally {
      vi.doUnmock("~/lib/cameraLineDetection");
      vi.resetModules();
    }
  });

  // public qa guard
  it("does not force live detector work for public detection detail requests", async () => {
    const app = buildApp();

    const response = await request(app)
      .get("/api/cameras/line-detection?ids=9164&includeDetections=true")
      .expect(200);

    expect(response.body["9164"]?.detections).toBeUndefined();
    expect(response.body["9164"]?.error).toBe(
      "No cached line detection status"
    );
  });
});

// camera line detection service
describe("CameraLineDetectionService", () => {
  // reset timer mocks
  afterEach(() => {
    vi.useRealTimers();
  });

  // configured camera list guard
  it("uses reviewed cameras with include polygons as default targets", () => {
    expect(getLineDetectionCameraIds()).toContain("9164");
    expect(getLineDetectionCameraIds()).toContain("9166");
  });

  // injected detector path
  it("fetches a frame, runs the detector, and counts included vehicles", async () => {
    const config = getLineDetectionCameraConfig("9164");
    expect(config).toBeTruthy();
    const point = findInteriorPoint(config!.allowedAreas[0].polygon);
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse());
    const detector = vi.fn().mockResolvedValue([
      {
        box: {
          height: 0.02,
          width: 0.02,
          x: point[0] - 0.01,
          y: point[1] - 0.01,
        },
        confidence: 0.9,
        label: "car",
      },
    ]);
    const service = new CameraLineDetectionService({
      detector,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 1000,
      minCheckIntervalMs: 1000,
    });

    const result = await service.getDetections(["9164"]);

    expect(fetchImpl).toHaveBeenCalledWith(
      config!.imageUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(detector).toHaveBeenCalledWith(
      expect.objectContaining({ cameraId: "9164", imageUrl: config!.imageUrl })
    );
    expect(result["9164"]?.error).toBeNull();
    expect(result["9164"]?.includedDetectionCount).toBe(1);
  });

  // qa detection path
  it("can include classified detections for QA overlays", async () => {
    const config = getLineDetectionCameraConfig("9164");
    expect(config).toBeTruthy();
    const point = findInteriorPoint(config!.allowedAreas[0].polygon);
    const service = new CameraLineDetectionService({
      detector: vi.fn().mockResolvedValue([
        {
          box: {
            height: 0.02,
            width: 0.02,
            x: point[0] - 0.01,
            y: point[1] - 0.01,
          },
          confidence: 0.9,
          label: "car",
        },
      ]),
      fetchImpl: vi
        .fn()
        .mockResolvedValue(imageResponse()) as unknown as typeof fetch,
      getNowMs: () => 1500,
    });

    const result = await service.getDetections(["9164"], {
      includeDetections: true,
    });

    expect(result["9164"]?.detections).toEqual([
      expect.objectContaining({
        allowedAreaIds: [config!.allowedAreas[0].id],
        disposition: "included",
        excludedAreaIds: [],
      }),
    ]);
  });

  // detector burst guard
  it("refreshes configured cameras serially", async () => {
    let activeDetections = 0;
    let maximumActiveDetections = 0;
    const service = new CameraLineDetectionService({
      detector: async () => {
        activeDetections += 1;
        maximumActiveDetections = Math.max(
          maximumActiveDetections,
          activeDetections
        );
        await Promise.resolve();
        activeDetections -= 1;
        return [];
      },
      fetchImpl: vi
        .fn()
        .mockResolvedValue(imageResponse()) as unknown as typeof fetch,
      getNowMs: () => 1600,
    });

    await service.refreshDetections(["9164", "9166"]);

    expect(maximumActiveDetections).toBe(1);
  });

  // configured endpoint post path
  it("posts camera bytes to the configured detector URL", async () => {
    const config = getLineDetectionCameraConfig("9164");
    expect(config).toBeTruthy();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detections: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    const service = new CameraLineDetectionService({
      detectorEndpoint: "http://detector.internal:8000/detect",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 1750,
    });

    await service.getDetections(["9164"]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      config!.imageUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://detector.internal:8000/detect",
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        headers: expect.objectContaining({
          "Content-Type": "image/jpeg",
          "X-Camera-Id": "9164",
          "X-Detection-Areas": JSON.stringify({
            allowedAreas: config!.allowedAreas,
            excludedAreas: config!.excludedAreas,
          }),
          "X-Image-Url": config!.imageUrl,
        }),
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
  });

  // malformed detector guard
  it("returns an explicit error for malformed detector responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detections: [{ label: "car" }] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    const service = new CameraLineDetectionService({
      detectorEndpoint: "http://detector.internal:8000/detect",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 1800,
    });

    const result = await service.getDetections(["9164"]);

    expect(result["9164"]?.error).toBe(
      "Detector response contains malformed detection"
    );
    expect(result["9164"]?.includedDetectionCount).toBe(0);
  });

  // unknown camera guard
  it("does not call the detector or cache work for unknown camera ids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse());
    const detector = vi.fn().mockResolvedValue([]);
    const service = new CameraLineDetectionService({
      detector,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 1900,
    });

    const result = await service.getDetections(["unknown-camera"]);
    const repeated = await service.getDetections(["unknown-camera"], {
      includeDetections: true,
    });

    expect(result["unknown-camera"]?.error).toBe("Camera is not configured");
    expect(repeated["unknown-camera"]?.error).toBe("Camera is not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(detector).not.toHaveBeenCalled();
  });

  // timeout clearing guard
  it("returns timeout errors and clears in-progress work", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse())
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          // abort listener
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
    const service = new CameraLineDetectionService({
      detectorEndpoint: "http://detector.internal:8000/detect",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 1950,
      timeoutMs: 10,
    });

    const timedOut = service.getDetections(["9164"]);
    await vi.advanceTimersByTimeAsync(10);
    const timeoutResult = await timedOut;
    fetchImpl
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detections: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );

    const recoveredResult = await service.getDetections(["9164"], {
      includeDetections: true,
    });

    expect(timeoutResult["9164"]?.error).toBe("Detector request timed out");
    expect(recoveredResult["9164"]?.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  // missing detector guard
  it("returns a zero-count error when no detector endpoint is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse());
    const service = new CameraLineDetectionService({
      detectorEndpoint: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => 2000,
    });

    const result = await service.getDetections(["9164"]);

    expect(result["9164"]?.error).toBe(
      "CAR_DETECTION_ENDPOINT is not configured"
    );
    expect(result["9164"]?.includedDetectionCount).toBe(0);
  });
});
