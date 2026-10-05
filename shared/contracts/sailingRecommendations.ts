export type TravelMode = "drive" | "walk" | "bicycle" | "transit";

export type RecommendationOrigin =
  | { kind: "coordinates"; latitude: number; longitude: number }
  | { kind: "place"; placeId: string }
  | { kind: "address"; address: string };

export interface SailingRecommendationRequest {
  arrivingTerminalId: string;
  bufferMinutes: number;
  departingTerminalId: string;
  mode: TravelMode;
  origin: RecommendationOrigin;
}

export type RecommendationFailureReason =
  | "configuration-unavailable"
  | "provider-quota-unavailable"
  | "provider-timeout"
  | "provider-unavailable"
  | "no-route"
  | "origin-needs-correction"
  | "ferry-route-recursion"
  | "invalid-request"
  | "stale-result"
  | "schedule-unavailable";

export interface FillTimingCapacity {
  anchorAgeSeconds: number | null;
  anchorAt: number | null;
  confidence: "low" | "medium";
  fillAt: number | null;
  fillRange: { earliest: number | null; latest: number | null } | null;
  modelVersion: "fill-linear-v1";
  observedSpacesAtAnchor: number | null;
  predictedSpacesAtArrival: number | null;
  priorKind: "departure-point" | "zero-prior" | "live-only" | null;
  projection?: {
    rate: {
      maximum: number;
      minimum: number;
      mostLikely: number;
    };
    totalSpaces: number;
  };
  state:
    | "available"
    | "already-full"
    | "predicted-full-by-now"
    | "not-expected-before-departure"
    | "unavailable";
}

export interface RecommendedSailing {
  sailingId?: string;
  capacity: FillTimingCapacity | null;
  meetsOperatorAdvice: boolean;
  operatorAdviceSeconds: number;
  operatorCutoffSeconds: number;
  projectedDepartureAt: number;
  scheduledDepartureAt: number;
  timingAssessment: "normal" | "tight";
  vesselName: string;
}

export interface TravelUncertainty {
  earliestArrivalAt: number;
  latestArrivalAt: number;
  modelVersion: "triangular-travel-v1";
  widthSeconds: number;
}

export interface SailingAssessment extends RecommendedSailing {
  sailingId: string;
  eligibilityReason: "cancelled" | "departed" | "mode-ineligible" | null;
  chance: {
    basis: "timing-and-capacity" | "timing-only";
    capacityProbability: number | null;
    depletionRateRange: {
      minimum: number;
      mostLikely: number;
      maximum: number;
    } | null;
    // present only when forecast fullness substitutes for unavailable live inventory
    forecastFullProbability?: number;
    modelVersion: "joint-triangular-v1";
    // index readiness targets by buffer minutes; entry zero is actual-cutoff boarding chance
    probabilities: (number | null)[];
    timingProbabilities: number[];
  };
  spacesAtArrivalRange: { minimum: number; maximum: number } | null;
}

export type SailingSkipReason =
  | "cancelled"
  | "departed"
  | "mode-ineligible"
  | "too-late"
  | "drive-up-full"
  | "capacity-unavailable";

export interface RecommendationOutcome {
  reason?: RecommendationFailureReason;
  result:
    | "recommended"
    | "timing-only"
    | "no-catchable-sailing"
    | "routing-unavailable"
    | "schedule-unavailable";
  sailing: RecommendedSailing | null;
  skipped: { departureAt: number; reason: SailingSkipReason }[];
}

export interface BufferOutcomeBand {
  maximumBufferMinutes: number;
  minimumBufferMinutes: number;
  outcome: RecommendationOutcome;
}

export interface SailingRecommendationResponse {
  arrivalAt: number | null;
  attribution: "Google Maps";
  bufferOutcomeBands: BufferOutcomeBand[];
  capacityWatermark: number | null;
  durationSeconds: number | null;
  mode: TravelMode;
  outcome: RecommendationOutcome;
  partialMatch: boolean;
  recommendationAsOf: number;
  revision: string | null;
  routeRequestedAt: number;
  source: "google-routes";
  sailingAssessments?: SailingAssessment[];
  staticDurationSeconds?: number | null;
  trafficAware: boolean | null;
  trafficDelaySeconds?: number | null;
  trafficLevel?: "light" | "moderate" | "heavy" | null;
  travelUncertainty?: TravelUncertainty | null;
  validUntil: number;
  warnings: string[];
}
