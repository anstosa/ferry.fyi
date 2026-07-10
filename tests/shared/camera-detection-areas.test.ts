import { describe, expect, it } from "vitest";

import detectionAreas from "../../shared/data/camera-detection-areas.json";
import cameras from "../../shared/data/cameras.json";
import wsfCore from "../../shared/data/wsf-core.json";

interface DetectionArea {
  id: string;
  type: string;
  label: string;
  polygon: number[][];
}

interface DetectionCamera {
  terminal: string;
  terminalId: string;
  displayName: string;
  title: string;
  frameSize: { width: number; height: number };
  imageUrl: string;
  reviewed: boolean;
  requiresDaylightReview: boolean;
  allowedAreas: DetectionArea[];
  excludedAreas: DetectionArea[];
  excludedAreaNotes: string[];
}

const allowedAreaTypes = [
  "queue_lane",
  "holding_lane",
  "holding_lot",
  "ferry_slip",
];
const excludedAreaTypes = [
  "intersection_break",
  "driveway_break",
  "crosswalk_break",
  "parking_exclusion",
  "opposing_lane_exclusion",
  "other_exclusion",
];
const detectionCameras = detectionAreas.cameras as Record<
  string,
  DetectionCamera
>;

// manual annotation guard
describe("camera detection areas", () => {
  // inventory guard
  it("covers every WSF camera with app-data metadata", () => {
    expect(detectionAreas.schemaVersion).toBe(2);
    expect([...detectionAreas.cameraIds].sort()).toEqual(
      Object.keys(wsfCore.cameras).sort()
    );
    expect(Object.keys(detectionCameras).sort()).toEqual(
      Object.keys(wsfCore.cameras).sort()
    );

    // every camera has matching app metadata
    detectionAreas.cameraIds.forEach((cameraId) => {
      expect(
        detectionCameras[cameraId],
        `${cameraId} detection metadata`
      ).toBeTruthy();
      expect(
        wsfCore.cameras[cameraId as keyof typeof wsfCore.cameras]
      ).toBeTruthy();
      expect(cameras[cameraId as keyof typeof cameras]).toBeTruthy();
    });
  });

  // reviewed camera guard
  it("preserves the reviewed Clinton and Mukilteo annotations", () => {
    expect(detectionAreas.status).toBe("manual-partial-review");
    expect(detectionAreas.reviewedCameraIds).toEqual([
      "9161",
      "9163",
      "9164",
      "9166",
      "9172",
      "9173",
      "9174",
      "9175",
      "9394",
      "9728",
    ]);

    // every reviewed camera is flagged in camera metadata
    detectionAreas.reviewedCameraIds.forEach((cameraId) => {
      expect(detectionCameras[cameraId].reviewed, cameraId).toBe(true);
    });
  });

  // metadata drift guard
  it("keeps image metadata and review state explicit", () => {
    // every camera carries explicit data for the annotator and runtime
    detectionAreas.cameraIds.forEach((cameraId) => {
      const camera = detectionCameras[cameraId];
      const coreCamera =
        wsfCore.cameras[cameraId as keyof typeof wsfCore.cameras];

      expect(camera.imageUrl, `${cameraId} image URL`).toBe(
        coreCamera.image.url
      );
      expect(camera.frameSize.width, `${cameraId} frame width`).toBeGreaterThan(
        0
      );
      expect(
        camera.frameSize.height,
        `${cameraId} frame height`
      ).toBeGreaterThan(0);
      expect(typeof camera.reviewed, `${cameraId} reviewed`).toBe("boolean");
      expect(Array.isArray(camera.allowedAreas), cameraId).toBe(true);
      expect(Array.isArray(camera.excludedAreas), cameraId).toBe(true);
      expect(Array.isArray(camera.excludedAreaNotes), cameraId).toBe(true);
    });
  });

  // normalized polygon guard
  it("uses supported normalized include and exclusion polygons", () => {
    // every polygon is typed and normalized
    detectionAreas.cameraIds.forEach((cameraId) => {
      const camera = detectionCameras[cameraId];
      const polygons = [
        ...camera.allowedAreas.map((area) => ({
          area,
          allowedTypes: allowedAreaTypes,
        })),
        ...camera.excludedAreas.map((area) => ({
          area,
          allowedTypes: excludedAreaTypes,
        })),
      ];

      // annotated cameras must also be reviewed
      if (polygons.length > 0) {
        expect(camera.reviewed, `${cameraId} reviewed`).toBe(true);
      }

      // every polygon has a valid shape
      polygons.forEach(({ area, allowedTypes }) => {
        expect(allowedTypes, `${area.id} type`).toContain(area.type);
        expect(area.label.trim(), `${area.id} label`).not.toBe("");
        expect(
          area.polygon.length,
          `${area.id} polygon point count`
        ).toBeGreaterThanOrEqual(3);

        // every point is normalized
        area.polygon.forEach(([x, y]) => {
          expect(x, `${area.id} x coordinate`).toBeGreaterThanOrEqual(0);
          expect(x, `${area.id} x coordinate`).toBeLessThanOrEqual(1);
          expect(y, `${area.id} y coordinate`).toBeGreaterThanOrEqual(0);
          expect(y, `${area.id} y coordinate`).toBeLessThanOrEqual(1);
        });
      });
    });
  });
});
