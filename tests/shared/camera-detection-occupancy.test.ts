import { describe, expect, it } from "vitest";

import type {
  CameraDetectionArea,
  CameraDetectionCameraConfig,
  VehicleDetection,
} from "../../shared/contracts/cameraDetection";
import {
  evaluateCameraOccupancy,
  getAreaSpatialOccupancy,
  getCameraAreaOccupancyState,
  isPointInPolygon,
} from "../../shared/lib/cameraDetection";

const laneArea: CameraDetectionArea = {
  id: "lane_a",
  label: "Lane A",
  polygon: [
    [0, 0],
    [1, 0],
    [1, 0.2],
    [0, 0.2],
  ],
  type: "queue_lane",
};

const cameraConfig: CameraDetectionCameraConfig = {
  allowedAreas: [laneArea],
  displayName: "Test camera",
  excludedAreaNotes: [],
  excludedAreas: [
    {
      id: "intersection",
      label: "Intersection break",
      polygon: [
        [0.45, 0],
        [0.55, 0],
        [0.55, 0.2],
        [0.45, 0.2],
      ],
      type: "intersection_break",
    },
  ],
  frameSize: { height: 100, width: 100 },
  imageUrl: "https://example.com/camera.jpg",
  requiresDaylightReview: false,
  reviewed: true,
  terminal: "Test",
  terminalId: "1",
  title: "Test camera",
};

// build one spatial detection
const vehicle = (x: number, width: number): VehicleDetection => ({
  box: { height: 0.1, width, x, y: 0.05 },
  confidence: 0.9,
  label: "car",
});

// camera occupancy geometry
describe("camera detection occupancy", () => {
  // polygon inclusion guard
  it("detects normalized points inside polygons", () => {
    expect(isPointInPolygon([0.5, 0.1], laneArea.polygon)).toBe(true);
    expect(isPointInPolygon([0.5, 0.5], laneArea.polygon)).toBe(false);
  });

  // spatial coverage guard
  it("measures occupied lane length without counting vehicles", () => {
    expect(getAreaSpatialOccupancy(laneArea, [])).toBe(0);
    expect(getAreaSpatialOccupancy(laneArea, [vehicle(0.1, 0.2)])).toBeCloseTo(
      0.2
    );
    expect(
      getAreaSpatialOccupancy(laneArea, [vehicle(0.1, 0.3), vehicle(0.4, 0.3)])
    ).toBeCloseTo(0.6);
  });

  // state boundary guard
  it("returns the four spatial occupancy states", () => {
    expect(getCameraAreaOccupancyState(0)).toBe("empty");
    expect(getCameraAreaOccupancyState(0.49)).toBe("minority_full");
    expect(getCameraAreaOccupancyState(0.5)).toBe("majority_full");
    expect(getCameraAreaOccupancyState(0.84)).toBe("majority_full");
    expect(getCameraAreaOccupancyState(0.85)).toBe("full");
  });

  // area state guard
  it("returns one state per configured queue polygon", () => {
    const result = evaluateCameraOccupancy("test-camera", cameraConfig, [
      vehicle(0.05, 0.2),
      vehicle(0.7, 0.2),
    ]);

    expect(result).not.toHaveProperty("detectionCount");
    expect(result).not.toHaveProperty("includedDetectionCount");
    expect(result).not.toHaveProperty("occupancyPercent");
    expect(result.areaStates).toEqual([
      {
        areaId: "lane_a",
        label: "Lane A",
        state: "minority_full",
        type: "queue_lane",
      },
    ]);
  });

  // exclusion state guard
  it("does not treat excluded vehicle signals as occupied", () => {
    const result = evaluateCameraOccupancy("test-camera", cameraConfig, [
      vehicle(0.46, 0.08),
    ]);

    expect(result.areaStates[0]?.state).toBe("empty");
  });

  // qa classification guard
  it("optionally returns classified detections for QA overlays", () => {
    const result = evaluateCameraOccupancy(
      "test-camera",
      cameraConfig,
      [vehicle(0.1, 0.1), vehicle(0.46, 0.08), vehicle(1.1, 0.1)],
      true
    );

    expect(result.detections).toEqual([
      expect.objectContaining({ disposition: "included" }),
      expect.objectContaining({ disposition: "excluded" }),
      expect.objectContaining({ disposition: "outside" }),
    ]);
  });
});
