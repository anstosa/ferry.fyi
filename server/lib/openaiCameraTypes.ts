import type { CameraDetectionCameraConfig } from "shared/contracts/cameraDetection";

export type OpenaiCameraOccupancy = "empty" | "low" | "high" | "full";

// retain model classifications for individual annotated sections
export interface OpenaiCameraSectionResult {
  cameraId: string;
  laneId: string;
  skippedDueToVisibility: boolean;
  occupancyState: OpenaiCameraOccupancy | null;
  passing: boolean | null;
}

// keep whole-image visibility separate from per-section classifications
export interface OpenaiCameraImageResult {
  cameraId: string;
  visibilityProblems: boolean;
  lanes: OpenaiCameraSectionResult[];
}

// pass transient image bytes only to the dedicated provider
export interface OpenaiCameraPromptImage {
  cameraId: string;
  imageBase64: string;
  laneIds: string[];
}

// describe native-scale preprocessing without storing the image
export interface PreparedOpenaiCameraImage extends OpenaiCameraPromptImage {
  fingerprint: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  rotationDegrees: number;
}

// map section ids explicitly to physical lanes
export interface OpenaiPhysicalLane {
  laneId: string;
  sectionIds: string[];
}

// bind reviewed geometry to terminal scan order
export interface OpenaiCameraDefinition {
  cameraId: string;
  terminalId: string;
  order: number;
  markerId: string;
  config: CameraDetectionCameraConfig;
  physicalLanes: OpenaiPhysicalLane[];
}

// summarize equal-weight section occupancy without merging motion heuristics
export interface OpenaiPhysicalLaneResult extends OpenaiPhysicalLane {
  cameraId: string;
  occupancyState: OpenaiCameraOccupancy | null;
  skippedDueToVisibility: boolean;
}

// retain derived evidence and independent source/check/inference timing
export interface OpenaiCameraObservation {
  cameraId: string;
  checkedAt: number;
  inferredAt: number | null;
  frameUpdatedAt: number | null;
  frameUnchangedSince: number;
  frameToken: string;
  fingerprint: string | null;
  inferenceKey: string | null;
  lastSubmittedSlot: number | null;
  result: OpenaiCameraImageResult | null;
  lanes: OpenaiPhysicalLaneResult[];
  error: string | null;
  freshness: "fresh" | "stale" | "unknown";
  reused: boolean;
}

// resume adaptive searches from the last reliable terminal tail
export interface OpenaiCameraTerminalState {
  lastCheckedAt: number;
  lastFullScanAt: number | null;
  nextCheckAt: number;
  tailCameraId: string | null;
  stableRounds: number;
  uncertain: boolean;
  coverage: "full" | "tail-search";
  coveredCameraIds: string[];
  errors: string[];
}

// fence round claims across processes and restarts
export interface OpenaiCameraPipelineState {
  version: 1;
  lastStartedSlot: number | null;
  lastCompletedAt: number | null;
  cameras: Record<string, OpenaiCameraObservation>;
  terminals: Record<string, OpenaiCameraTerminalState>;
}
