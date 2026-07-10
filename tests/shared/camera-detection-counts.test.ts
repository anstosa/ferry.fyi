import { describe, expect, it } from "vitest";

import type { CameraDetectionCameraConfig } from "../../shared/contracts/cameraDetection";
import {
  countCameraDetections,
  isPointInPolygon,
} from "../../shared/lib/cameraDetection";

const cameraConfig: CameraDetectionCameraConfig = {
  allowedAreas: [
    {
      id: "lane_a",
      label: "Lane A",
      polygon: [
        [0, 0],
        [0.6, 0],
        [0.6, 1],
        [0, 1],
      ],
      type: "queue_lane",
    },
    {
      id: "lane_b",
      label: "Lane B",
      polygon: [
        [0.4, 0],
        [1, 0],
        [1, 1],
        [0.4, 1],
      ],
      type: "holding_lane",
    },
  ],
  displayName: "Test camera",
  excludedAreaNotes: [],
  excludedAreas: [
    {
      id: "intersection",
      label: "Intersection break",
      polygon: [
        [0.45, 0.45],
        [0.55, 0.45],
        [0.55, 0.55],
        [0.45, 0.55],
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

// camera detection geometry
describe("camera detection counting", () => {
  // polygon inclusion guard
  it("detects normalized points inside polygons", () => {
    expect(
      isPointInPolygon([0.5, 0.5], cameraConfig.allowedAreas[0].polygon)
    ).toBe(true);
    expect(
      isPointInPolygon([0.9, 0.5], cameraConfig.allowedAreas[0].polygon)
    ).toBe(false);
  });

  // include and exclusion counting guard
  it("counts vehicle detections inside includes while subtracting exclusions", () => {
    const result = countCameraDetections("test-camera", cameraConfig, [
      {
        box: { height: 0.1, width: 0.1, x: 0.1, y: 0.1 },
        confidence: 0.9,
        label: "car",
      },
      {
        box: { height: 0.1, width: 0.1, x: 0.46, y: 0.46 },
        confidence: 0.9,
        label: "truck",
      },
      {
        box: { height: 0.1, width: 0.1, x: 0.8, y: 0.8 },
        confidence: 0.9,
        label: "person",
      },
      {
        box: { height: 0.1, width: 0.1, x: 0.8, y: 0.2 },
        confidence: 0.9,
        label: "bus",
      },
    ]);

    expect(result.detectionCount).toBe(3);
    expect(result.includedDetectionCount).toBe(2);
    expect(result.excludedDetectionCount).toBe(1);
    expect(result.areaCounts).toEqual([
      {
        areaId: "lane_a",
        label: "Lane A",
        type: "queue_lane",
        vehicleCount: 1,
      },
      {
        areaId: "lane_b",
        label: "Lane B",
        type: "holding_lane",
        vehicleCount: 1,
      },
    ]);
  });

  // qa classification guard
  it("optionally returns classified detections for QA overlays", () => {
    const result = countCameraDetections(
      "test-camera",
      cameraConfig,
      [
        {
          box: { height: 0.1, width: 0.1, x: 0.1, y: 0.1 },
          confidence: 0.9,
          label: "car",
        },
        {
          box: { height: 0.1, width: 0.1, x: 0.46, y: 0.46 },
          confidence: 0.9,
          label: "truck",
        },
        {
          box: { height: 0.1, width: 0.1, x: 0.9, y: 0.9 },
          confidence: 0.9,
          label: "car",
        },
      ],
      true
    );

    expect(result.detections).toEqual([
      expect.objectContaining({ disposition: "included" }),
      expect.objectContaining({ disposition: "excluded" }),
      expect.objectContaining({ disposition: "included" }),
    ]);
  });

  // occupancy capacity guard
  it("reports occupancy only when every countable area has a capacity", () => {
    const configWithCapacity: CameraDetectionCameraConfig = {
      ...cameraConfig,
      allowedAreas: cameraConfig.allowedAreas.map((area) => ({
        ...area,
        vehicleCapacity: 10,
      })),
    };

    const result = countCameraDetections("test-camera", configWithCapacity, [
      {
        box: { height: 0.1, width: 0.1, x: 0.1, y: 0.1 },
        confidence: 0.9,
        label: "car",
      },
      {
        box: { height: 0.1, width: 0.1, x: 0.8, y: 0.1 },
        confidence: 0.9,
        label: "car",
      },
    ]);

    expect(result.vehicleCapacity).toBe(20);
    expect(result.occupancyPercent).toBe(10);
    expect(result.areaCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ occupancyPercent: 10, vehicleCapacity: 10 }),
      ])
    );
  });

  // full capacity guard
  it("caps occupancy at the available countable capacity", () => {
    const configWithCapacity: CameraDetectionCameraConfig = {
      ...cameraConfig,
      allowedAreas: cameraConfig.allowedAreas.map((area) => ({
        ...area,
        vehicleCapacity: 10,
      })),
    };
    const detections = Array.from({ length: 21 }, (_, index) => ({
      box: { height: 0.01, width: 0.01, x: 0.1, y: index / 25 },
      confidence: 0.9,
      label: "car",
    }));

    const result = countCameraDetections(
      "test-camera",
      configWithCapacity,
      detections
    );

    expect(result.occupancyPercent).toBe(100);
    expect(result.areaCounts[0]).toEqual(
      expect.objectContaining({ occupancyPercent: 100, vehicleCount: 21 })
    );
  });

  // invalid capacity guard
  it("withholds occupancy when a countable area has no positive capacity", () => {
    const configWithZeroCapacity: CameraDetectionCameraConfig = {
      ...cameraConfig,
      allowedAreas: cameraConfig.allowedAreas.map((area, index) => ({
        ...area,
        vehicleCapacity: index === 0 ? 0 : 10,
      })),
    };

    const result = countCameraDetections(
      "test-camera",
      configWithZeroCapacity,
      []
    );

    expect(result.vehicleCapacity).toBeNull();
    expect(result.occupancyPercent).toBeNull();
    expect(result.areaCounts[0]).not.toHaveProperty("occupancyPercent");
  });
});
