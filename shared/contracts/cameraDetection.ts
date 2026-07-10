export type CameraDetectionAreaType =
  | "queue_lane"
  | "holding_lane"
  | "holding_lot"
  | "ferry_slip";

export type CameraDetectionExclusionType =
  | "intersection_break"
  | "driveway_break"
  | "crosswalk_break"
  | "parking_exclusion"
  | "opposing_lane_exclusion"
  | "other_exclusion";

export type CameraDetectionPoint = [number, number];

export interface CameraDetectionArea {
  id: string;
  label: string;
  polygon: CameraDetectionPoint[];
  type: CameraDetectionAreaType | CameraDetectionExclusionType;
  vehicleCapacity?: number;
}

export interface CameraDetectionCameraConfig {
  allowedAreas: CameraDetectionArea[];
  displayName: string;
  excludedAreaNotes: string[];
  excludedAreas: CameraDetectionArea[];
  frameSize: { height: number; width: number };
  imageUrl: string;
  requiresDaylightReview: boolean;
  reviewed: boolean;
  terminal: string;
  terminalId: string;
  title: string;
}

export interface CameraDetectionAreasConfig {
  cameraIds: string[];
  cameras: Record<string, CameraDetectionCameraConfig>;
  coordinateSpace: "normalized-image";
  origin: "top-left";
  pointFormat: ["x", "y"];
  reviewedCameraIds: string[];
  schemaVersion: 2;
  status: string;
}

export interface VehicleDetectionBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface VehicleDetection {
  box: VehicleDetectionBox;
  confidence: number;
  label: string;
}

export type CameraLineDetectionDisposition =
  | "included"
  | "excluded"
  | "outside";

export interface CameraLineVehicleDetection extends VehicleDetection {
  allowedAreaIds: string[];
  center: CameraDetectionPoint;
  disposition: CameraLineDetectionDisposition;
  excludedAreaIds: string[];
}

export interface CameraAreaVehicleCount {
  areaId: string;
  label: string;
  type: CameraDetectionAreaType | CameraDetectionExclusionType;
  vehicleCount: number;
  vehicleCapacity?: number;
  occupancyPercent?: number;
}

export interface CameraLineDetectionResult {
  areaCounts: CameraAreaVehicleCount[];
  cameraId: string;
  detectionCount: number;
  detections?: CameraLineVehicleDetection[];
  excludedDetectionCount: number;
  imageUrl: string;
  includedDetectionCount: number;
  occupancyPercent: number | null;
  reviewed: boolean;
  vehicleCapacity: number | null;
}

export interface CameraLineDetectionStatus extends CameraLineDetectionResult {
  checkedAt: number;
  error: string | null;
}

export type CameraLineDetectionResponse = Record<
  string,
  CameraLineDetectionStatus
>;
