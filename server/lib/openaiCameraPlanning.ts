import type { CameraDetectionAreasConfig } from "shared/contracts/cameraDetection";
import detectionData from "shared/data/camera-detection-areas.json";
import cameraMetadata from "shared/data/cameras.json";

import { OPENAI_CAMERA_SLOT_MS } from "./openaiCameraSchedule";
import type {
  OpenaiCameraDefinition,
  OpenaiCameraImageResult,
  OpenaiCameraOccupancy,
  OpenaiPhysicalLaneResult,
} from "./openaiCameraTypes";

export { OPENAI_CAMERA_SLOT_MS };
export const OPENAI_CAMERA_VALIDATION_MS = 15 * 60_000;

const occupancyScores: Record<OpenaiCameraOccupancy, number> = {
  empty: 0,
  low: 0.25,
  high: 0.675,
  full: 1,
};

// turn equal-weight coarse scores into the private occupancy vocabulary
const occupancyFromScore = (
  score: number | null
): OpenaiCameraOccupancy | null => {
  // preserve unobservable required sections
  if (score === null) {
    return null;
  }
  // keep truly empty distinct from low occupancy
  if (score === 0) {
    return "empty";
  }
  // distinguish less than half full
  if (score < 0.5) {
    return "low";
  }
  // retain the existing approximate full threshold
  if (score < 0.85) {
    return "high";
  }
  return "full";
};

// retain explicit identity for irregular existing section ids
const clintonSections = [
  [
    "clinton_clinton_terminal_holding_lane_1_front",
    "clinton_clinton_terminal_holding_lane_1_back",
  ],
  [
    "clinton_clinton_terminal_holding_lane_2_front",
    "clinton_clinton_terminal_queue_lane_2_back",
  ],
  [
    "clinton_clinton_terminal_holding_lane_3_front",
    "clinton_clinton_terminal_queue_lane_3_back",
  ],
  [
    "clinton_clinton_terminal_holding_lane_4_front",
    "clinton_clinton_terminal_queue_lane_4_back",
  ],
  [
    "clinton_clinton_terminal_holding_lane_5_front",
    "clinton_clinton_terminal_queue_lane_5_back",
  ],
  [
    "clinton_clinton_terminal_holding_lane_6_front",
    "clinton_clinton_terminal_queue_lane_6",
  ],
  [
    "clinton_clinton_terminal_holding_lane_7_front",
    "clinton_clinton_terminal_queue_lane_7_back",
  ],
];

// assign operational checks to clock slots rather than rolling cooldowns
export const getOpenaiCameraSlot = (now: number): number =>
  Math.floor(now / OPENAI_CAMERA_SLOT_MS) * OPENAI_CAMERA_SLOT_MS;

// choose the tick strictly before the current predicted departure
export const getOpenaiPredepartureSlot = (departureAt: number): number =>
  (Math.ceil(departureAt / OPENAI_CAMERA_SLOT_MS) - 1) * OPENAI_CAMERA_SLOT_MS;

// derive the reviewed scan set without changing the public detector
export const getOpenaiCameraDefinitions = (): OpenaiCameraDefinition[] => {
  const data = detectionData as unknown as CameraDetectionAreasConfig;
  const metadata = cameraMetadata as Record<
    string,
    { orderFromTerminal: number }
  >;
  const definitions: OpenaiCameraDefinition[] = [];
  // preserve explicit enablement and reviewed regions
  for (const cameraId of data.cameraIds) {
    const config = data.cameras[cameraId];
    // never silently activate unreviewed cameras
    if (
      !config.reviewed ||
      config.detectionEnabled === false ||
      !config.allowedAreas.length
    ) {
      continue;
    }
    // keep physical grouping separate from raw section ids
    const physicalLanes = config.allowedAreas.map((area) => ({
      laneId: area.id,
      sectionIds: [area.id],
    }));
    // combine explicit front/back pairs only at Clinton holding
    if (cameraId === "9166") {
      const grouped = new Set(clintonSections.flat());
      physicalLanes.splice(
        0,
        physicalLanes.length,
        // retain separately annotated front/back identities
        ...clintonSections.map((sectionIds, index) => ({
          laneId: `clinton_holding_lane_${index + 1}`,
          sectionIds: [...sectionIds],
        })),
        // preserve future ungrouped reviewed sections
        ...config.allowedAreas
          .filter((area) => !grouped.has(area.id))
          .map((area) => ({
            laneId: area.id,
            sectionIds: [area.id],
          }))
      );
    }
    definitions.push({
      cameraId,
      terminalId: config.terminalId,
      order: metadata[cameraId]?.orderFromTerminal ?? Number.MAX_SAFE_INTEGER,
      markerId: ["9394", "9728"].includes(cameraId)
        ? "mukilteo-5th-street"
        : cameraId,
      config,
      physicalLanes,
    });
  }
  // sort deterministically by terminal and distance
  return definitions.sort(
    (left, right) =>
      left.terminalId.localeCompare(right.terminalId) ||
      left.order - right.order
  );
};

// aggregate coarse occupancy without inventing merged motion measurements
export const aggregateOpenaiCameraLanes = (
  definition: OpenaiCameraDefinition,
  image: OpenaiCameraImageResult
): OpenaiPhysicalLaneResult[] => {
  const sections = new Map(
    image.lanes.map((section) => [section.laneId, section])
  );
  // preserve uncertainty when any required section is not observable
  return definition.physicalLanes.map((lane) => {
    const results = lane.sectionIds.map((sectionId) => sections.get(sectionId));
    const skipped =
      image.visibilityProblems ||
      !results.length ||
      results.some(
        (section) =>
          !section ||
          section.skippedDueToVisibility ||
          section.occupancyState === null
      );
    const score = skipped
      ? null
      : results.reduce(
          (sum, section) => sum + occupancyScores[section!.occupancyState!],
          0
        ) / results.length;
    return {
      cameraId: definition.cameraId,
      ...lane,
      occupancyState: occupancyFromScore(score),
      skippedDueToVisibility: skipped,
    };
  });
};

// use stopped section evidence without treating invisible sections as empty
export const getOpenaiCameraQueueEvidence = (
  image: OpenaiCameraImageResult | null
): "queued" | "clear" | "unknown" => {
  // missing or unusable imagery cannot bound a queue
  if (!image || image.visibilityProblems || !image.lanes.length) {
    return "unknown";
  }
  // one observable stopped section establishes queue presence
  if (
    image.lanes.some(
      (section) =>
        !section.skippedDueToVisibility &&
        section.occupancyState !== null &&
        section.occupancyState !== "empty" &&
        section.passing === false
    )
  ) {
    return "queued";
  }
  // partial visibility cannot establish a reliable negative marker
  return image.lanes.some((section) => section.skippedDueToVisibility)
    ? "unknown"
    : "clear";
};
