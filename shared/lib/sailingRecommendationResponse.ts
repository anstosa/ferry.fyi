import type {
  RecommendationFailureReason,
  SailingRecommendationResponse,
  TravelMode,
} from "shared/contracts/sailingRecommendations";

// construct a sanitized unavailable result with no retained input
export const unavailableRecommendation = (
  mode: TravelMode,
  reason: RecommendationFailureReason,
  asOf: number
): SailingRecommendationResponse => ({
  arrivalAt: null,
  attribution: "Google Maps",
  bufferOutcomeBands: [],
  capacityWatermark: null,
  durationSeconds: null,
  mode,
  outcome: {
    reason,
    result:
      reason === "schedule-unavailable"
        ? "schedule-unavailable"
        : "routing-unavailable",
    sailing: null,
    skipped: [],
  },
  partialMatch: false,
  recommendationAsOf: asOf,
  revision: null,
  routeRequestedAt: asOf,
  source: "google-routes",
  sailingAssessments: [],
  staticDurationSeconds: null,
  trafficAware: null,
  trafficDelaySeconds: null,
  trafficLevel: null,
  travelUncertainty: null,
  validUntil: asOf,
  warnings: [],
});
