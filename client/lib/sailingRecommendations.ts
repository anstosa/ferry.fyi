import type {
  FillTimingCapacity,
  RecommendationOutcome,
  SailingAssessment,
  SailingRecommendationRequest,
  SailingRecommendationResponse,
  TravelMode,
} from "shared/contracts/sailingRecommendations";
import { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";

import { ApiError, post } from "./api";

const RESULTS = [
  "recommended",
  "timing-only",
  "no-catchable-sailing",
  "routing-unavailable",
  "schedule-unavailable",
];
const CAPACITY_STATES = [
  "available",
  "already-full",
  "predicted-full-by-now",
  "not-expected-before-departure",
  "unavailable",
];
const REASONS = [
  "configuration-unavailable",
  "provider-quota-unavailable",
  "provider-timeout",
  "provider-unavailable",
  "no-route",
  "origin-needs-correction",
  "ferry-route-recursion",
  "invalid-request",
  "stale-result",
  "schedule-unavailable",
];

// require only normalized contract fields at every retained boundary
const hasKeys = (
  value: unknown,
  required: string[],
  optional: string[] = []
): boolean => {
  // reject arrays and missing required fields
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
};

// constrain nullable numeric summaries without coercion
const isNullableNumber = (value: unknown): boolean =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

// validate one live-model percent-full projection
const isCapacityProjection = (capacity: FillTimingCapacity): boolean => {
  const { projection } = capacity;
  // keep legacy responses valid when no projection is published
  if (projection === undefined) {
    return true;
  }
  // require a complete finite denominator and rate distribution
  if (!hasKeys(projection, ["rate", "totalSpaces"])) {
    return false;
  }
  const { rate, totalSpaces } = projection;
  // validate nested rate keys before reading them
  if (
    !hasKeys(rate, ["maximum", "minimum", "mostLikely"]) ||
    !Number.isFinite(totalSpaces) ||
    totalSpaces <= 0 ||
    ![rate.minimum, rate.mostLikely, rate.maximum].every(
      (value) => Number.isFinite(value) && value >= 0
    ) ||
    rate.minimum > rate.mostLikely ||
    rate.mostLikely > rate.maximum
  ) {
    return false;
  }
  // bind the curve to the retained live inventory anchor
  return (
    capacity.state !== "unavailable" &&
    capacity.anchorAgeSeconds !== null &&
    capacity.anchorAt !== null &&
    capacity.observedSpacesAtAnchor !== null &&
    totalSpaces >= capacity.observedSpacesAtAnchor &&
    (capacity.predictedSpacesAtArrival === null ||
      totalSpaces >= capacity.predictedSpacesAtArrival) &&
    (capacity.state !== "already-full" ||
      (rate.minimum === 0 && rate.mostLikely === 0 && rate.maximum === 0))
  );
};

// validate the complete capacity summary before retaining it
const isCapacity = (value: unknown): value is FillTimingCapacity => {
  // reject undeclared model fields and raw observation payloads
  if (
    !hasKeys(
      value,
      [
        "anchorAgeSeconds",
        "anchorAt",
        "confidence",
        "fillAt",
        "fillRange",
        "modelVersion",
        "observedSpacesAtAnchor",
        "predictedSpacesAtArrival",
        "priorKind",
        "state",
      ],
      ["projection"]
    )
  ) {
    return false;
  }
  const capacity = value as FillTimingCapacity;
  return (
    CAPACITY_STATES.includes(capacity.state) &&
    capacity.modelVersion === "fill-linear-v1" &&
    ["low", "medium"].includes(capacity.confidence) &&
    [null, "departure-point", "zero-prior", "live-only"].includes(
      capacity.priorKind
    ) &&
    [
      capacity.anchorAgeSeconds,
      capacity.anchorAt,
      capacity.fillAt,
      capacity.observedSpacesAtAnchor,
      capacity.predictedSpacesAtArrival,
    ].every(isNullableNumber) &&
    (capacity.fillRange === null ||
      (hasKeys(capacity.fillRange, ["earliest", "latest"]) &&
        isNullableNumber(capacity.fillRange.earliest) &&
        isNullableNumber(capacity.fillRange.latest))) &&
    isCapacityProjection(capacity)
  );
};

// validate normalized selection summaries before retaining them
const isOutcome = (value: unknown): value is RecommendationOutcome => {
  // reject non-object outcomes
  if (!hasKeys(value, ["result", "sailing", "skipped"], ["reason"])) {
    return false;
  }
  const outcome = value as RecommendationOutcome;
  // reject unknown states or oversized candidate explanations
  if (
    !RESULTS.includes(outcome.result) ||
    (outcome.reason && !REASONS.includes(outcome.reason)) ||
    !Array.isArray(outcome.skipped) ||
    outcome.skipped.length > 300 ||
    outcome.skipped.some((entry) => {
      // retain only bounded candidate rejection summaries
      return (
        !hasKeys(entry, ["departureAt", "reason"]) ||
        !Number.isFinite(entry.departureAt) ||
        ![
          "cancelled",
          "departed",
          "mode-ineligible",
          "too-late",
          "drive-up-full",
          "capacity-unavailable",
        ].includes(entry.reason)
      );
    })
  ) {
    return false;
  }
  // validate a selected sailing only when present
  if (outcome.sailing !== null) {
    const { sailing } = outcome;
    // constrain all user-visible timing values
    if (
      !hasKeys(
        sailing,
        [
          "capacity",
          "meetsOperatorAdvice",
          "operatorAdviceSeconds",
          "operatorCutoffSeconds",
          "projectedDepartureAt",
          "scheduledDepartureAt",
          "timingAssessment",
          "vesselName",
        ],
        ["sailingId"]
      ) ||
      (sailing.sailingId !== undefined &&
        (typeof sailing.sailingId !== "string" ||
          sailing.sailingId.length > 256 ||
          !sailing.sailingId)) ||
      !Number.isFinite(sailing.projectedDepartureAt) ||
      !Number.isFinite(sailing.scheduledDepartureAt) ||
      !Number.isFinite(sailing.operatorAdviceSeconds) ||
      !Number.isFinite(sailing.operatorCutoffSeconds) ||
      typeof sailing.vesselName !== "string" ||
      sailing.vesselName.length > 120 ||
      typeof sailing.meetsOperatorAdvice !== "boolean" ||
      !["normal", "tight"].includes(sailing.timingAssessment)
    ) {
      return false;
    }
    const { capacity } = sailing;
    // reject invalid inventory state without trusting a raw provider body
    if (capacity !== null && !isCapacity(capacity)) {
      return false;
    }
  }
  // selected results require a sailing and failures must not retain one
  if (
    (outcome.result === "recommended" || outcome.result === "timing-only") !==
    (outcome.sailing !== null)
  ) {
    return false;
  }
  return true;
};

// constrain model probabilities without confusing unknown with impossible
const isProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

// validate a complete fixed-buffer assessment before rendering percentages
const isAssessment = (
  value: unknown,
  mode: TravelMode
): value is SailingAssessment => {
  // forbid retained provider fields and rider inputs
  if (
    !hasKeys(value, [
      "capacity",
      "chance",
      "eligibilityReason",
      "meetsOperatorAdvice",
      "operatorAdviceSeconds",
      "operatorCutoffSeconds",
      "projectedDepartureAt",
      "scheduledDepartureAt",
      "sailingId",
      "spacesAtArrivalRange",
      "timingAssessment",
      "vesselName",
    ])
  ) {
    return false;
  }
  const { chance, eligibilityReason, spacesAtArrivalRange, ...sailing } =
    value as SailingAssessment;
  // reuse the normalized sailing boundary for every neighboring departure
  if (
    !isOutcome({ result: "recommended", sailing, skipped: [] }) ||
    typeof sailing.sailingId !== "string" ||
    ![null, "cancelled", "departed", "mode-ineligible"].includes(
      eligibilityReason
    ) ||
    !hasKeys(
      chance,
      [
        "basis",
        "capacityProbability",
        "depletionRateRange",
        "modelVersion",
        "probabilities",
        "timingProbabilities",
      ],
      ["forecastFullProbability"]
    ) ||
    chance.modelVersion !== "joint-triangular-v1" ||
    chance.basis !==
      (mode === "drive" ? "timing-and-capacity" : "timing-only") ||
    (chance.capacityProbability !== null &&
      !isProbability(chance.capacityProbability)) ||
    (chance.forecastFullProbability !== undefined &&
      !isProbability(chance.forecastFullProbability)) ||
    !Array.isArray(chance.probabilities) ||
    chance.probabilities.length !== 61 ||
    !Array.isArray(chance.timingProbabilities) ||
    chance.timingProbabilities.length !== 61
  ) {
    return false;
  }
  const forecast = chance.forecastFullProbability;
  const hasForecast = forecast !== undefined;
  // permit only the declared forecast fallback without fabricated live-model details
  if (
    hasForecast &&
    (mode !== "drive" ||
      eligibilityReason !== null ||
      (sailing.capacity !== null && sailing.capacity.state !== "unavailable") ||
      chance.capacityProbability === null ||
      Math.abs(chance.capacityProbability - (1 - forecast)) > 1e-9 ||
      chance.depletionRateRange !== null ||
      spacesAtArrivalRange !== null)
  ) {
    return false;
  }
  // prevent numeric success when required capacity is unknown
  if (
    (mode === "drive" &&
      eligibilityReason === null &&
      (chance.capacityProbability === null) !==
        (chance.probabilities[0] === null)) ||
    (mode !== "drive" &&
      (chance.capacityProbability !== null ||
        sailing.capacity !== null ||
        chance.depletionRateRange !== null ||
        spacesAtArrivalRange !== null))
  ) {
    return false;
  }
  // reject capacity claims that conflict with the retained inventory state
  if (
    (eligibilityReason !== null &&
      (chance.capacityProbability !== null ||
        sailing.capacity !== null ||
        chance.depletionRateRange !== null ||
        spacesAtArrivalRange !== null)) ||
    (mode === "drive" &&
      eligibilityReason === null &&
      !hasForecast &&
      (sailing.capacity === null || sailing.capacity.state === "unavailable") &&
      (chance.probabilities[0] !== null ||
        chance.capacityProbability !== null ||
        chance.depletionRateRange !== null ||
        spacesAtArrivalRange !== null)) ||
    (mode === "drive" &&
      sailing.capacity?.state === "already-full" &&
      (chance.capacityProbability !== 0 ||
        chance.depletionRateRange !== null ||
        spacesAtArrivalRange?.minimum !== 0 ||
        spacesAtArrivalRange.maximum !== 0))
  ) {
    return false;
  }
  // known positive-anchor states require the complete joint model
  if (
    mode === "drive" &&
    eligibilityReason === null &&
    sailing.capacity !== null &&
    [
      "available",
      "predicted-full-by-now",
      "not-expected-before-departure",
    ].includes(sailing.capacity.state) &&
    (chance.capacityProbability === null ||
      chance.probabilities[0] === null ||
      chance.depletionRateRange === null ||
      spacesAtArrivalRange === null)
  ) {
    return false;
  }
  const rates = chance.depletionRateRange;
  // require an ordered nonnegative depletion prior
  if (
    rates !== null &&
    (!hasKeys(rates, ["minimum", "mostLikely", "maximum"]) ||
      ![rates.minimum, rates.mostLikely, rates.maximum].every(
        (rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0
      ) ||
      rates.minimum > rates.mostLikely ||
      rates.mostLikely > rates.maximum)
  ) {
    return false;
  }
  // keep the combined arrival and depletion support bounded and ordered
  if (
    spacesAtArrivalRange !== null &&
    (!hasKeys(spacesAtArrivalRange, ["minimum", "maximum"]) ||
      ![spacesAtArrivalRange.minimum, spacesAtArrivalRange.maximum].every(
        (spaces) =>
          typeof spaces === "number" && Number.isFinite(spaces) && spaces >= 0
      ) ||
      spacesAtArrivalRange.minimum > spacesAtArrivalRange.maximum)
  ) {
    return false;
  }
  // enforce finite joint probabilities and monotone buffer behavior
  for (let buffer = 0; buffer <= 60; buffer += 1) {
    const probability = chance.probabilities[buffer];
    const timing = chance.timingProbabilities[buffer];
    // joint success cannot exceed the same scenario's timing success
    if (
      !isProbability(timing) ||
      (mode !== "drive" &&
        eligibilityReason === null &&
        probability !== timing) ||
      ((eligibilityReason !== null ||
        (mode === "drive" && sailing.capacity?.state === "already-full")) &&
        probability !== 0) ||
      (hasForecast &&
        (probability === null ||
          Math.abs(probability - timing * (1 - forecast)) > 1e-9)) ||
      (probability !== null &&
        (!isProbability(probability) ||
          probability > timing + 1e-9 ||
          (chance.capacityProbability !== null &&
            probability > chance.capacityProbability + 1e-9))) ||
      (buffer > 0 && timing > chance.timingProbabilities[buffer - 1] + 1e-9) ||
      (buffer > 0 &&
        probability !== null &&
        chance.probabilities[buffer - 1] !== null &&
        probability > (chance.probabilities[buffer - 1] as number) + 1e-9) ||
      (buffer > 0 &&
        (probability === null) !== (chance.probabilities[0] === null))
    ) {
      return false;
    }
  }
  return true;
};

// fetch one explicit trip without persisting the transient origin
export const getSailingRecommendation = async (
  input: SailingRecommendationRequest
): Promise<SailingRecommendationResponse> => {
  let value: unknown;
  try {
    value = await post<unknown>(
      "/sailing-recommendations",
      input as unknown as Record<string, unknown>
    );
  } catch (error) {
    // discard response-bearing errors and preserve the normalized quota state
    if (error instanceof ApiError && error.status === 429) {
      return unavailableRecommendation(
        input.mode,
        "provider-quota-unavailable",
        Date.now() / 1000
      );
    }
    throw new Error("Sailing estimate unavailable");
  }
  // validate the minimal public response boundary
  if (
    !hasKeys(
      value,
      [
        "arrivalAt",
        "attribution",
        "bufferOutcomeBands",
        "capacityWatermark",
        "durationSeconds",
        "mode",
        "outcome",
        "partialMatch",
        "recommendationAsOf",
        "revision",
        "routeRequestedAt",
        "source",
        "trafficAware",
        "validUntil",
        "warnings",
      ],
      [
        "sailingAssessments",
        "staticDurationSeconds",
        "trafficDelaySeconds",
        "trafficLevel",
        "travelUncertainty",
      ]
    )
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  const response = value as SailingRecommendationResponse;
  // preserve old responses while strictly checking the new modeled-result fields
  if (
    (response.staticDurationSeconds !== undefined &&
      !isNullableNumber(response.staticDurationSeconds)) ||
    (response.trafficDelaySeconds !== undefined &&
      !isNullableNumber(response.trafficDelaySeconds)) ||
    (response.trafficLevel !== undefined &&
      ![null, "light", "moderate", "heavy"].includes(response.trafficLevel)) ||
    (response.trafficLevel !== null &&
      response.trafficLevel !== undefined &&
      (input.mode !== "drive" ||
        response.trafficAware !== true ||
        !response.staticDurationSeconds ||
        response.trafficDelaySeconds === null ||
        response.trafficDelaySeconds === undefined)) ||
    (response.sailingAssessments !== undefined &&
      (!Array.isArray(response.sailingAssessments) ||
        response.sailingAssessments.length > 183 ||
        new Set(
          response.sailingAssessments.map((sailing) => sailing?.sailingId)
        ).size !== response.sailingAssessments.length ||
        !response.sailingAssessments.every((assessment) => {
          // match every neighbor to the explicitly requested method
          return isAssessment(assessment, input.mode);
        })))
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  const uncertainty = response.travelUncertainty;
  // require either the complete new pair or a coherent legacy response
  if (
    (response.sailingAssessments === undefined) !==
    (response.travelUncertainty === undefined)
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  // require ordered arrival bounds around the same point eta
  if (
    ((response.sailingAssessments?.length ?? 0) > 0 &&
      (uncertainty === null || uncertainty === undefined)) ||
    (uncertainty !== null &&
      uncertainty !== undefined &&
      (!hasKeys(uncertainty, [
        "earliestArrivalAt",
        "latestArrivalAt",
        "modelVersion",
        "widthSeconds",
      ]) ||
        uncertainty.modelVersion !== "triangular-travel-v1" ||
        ![
          uncertainty.earliestArrivalAt,
          uncertainty.latestArrivalAt,
          uncertainty.widthSeconds,
        ].every(
          (value) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0
        ) ||
        response.arrivalAt === null ||
        uncertainty.earliestArrivalAt > response.arrivalAt ||
        uncertainty.latestArrivalAt < response.arrivalAt))
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  // validate bounded clocks, provider attribution and complete buffer coverage
  if (
    response.source !== "google-routes" ||
    response.attribution !== "Google Maps" ||
    response.mode !== input.mode ||
    !isNullableNumber(response.capacityWatermark) ||
    typeof response.partialMatch !== "boolean" ||
    (response.trafficAware !== null &&
      typeof response.trafficAware !== "boolean") ||
    (response.revision !== null &&
      (typeof response.revision !== "string" ||
        response.revision.length > 200000)) ||
    !Number.isFinite(response.recommendationAsOf) ||
    !Number.isFinite(response.routeRequestedAt) ||
    !Number.isFinite(response.validUntil) ||
    (response.arrivalAt !== null && !Number.isFinite(response.arrivalAt)) ||
    (response.durationSeconds !== null &&
      (!Number.isFinite(response.durationSeconds) ||
        response.durationSeconds < 0)) ||
    !Array.isArray(response.warnings) ||
    response.warnings.length > 20 ||
    response.warnings.some(
      (warning) => typeof warning !== "string" || warning.length > 2000
    ) ||
    !isOutcome(response.outcome) ||
    !Array.isArray(response.bufferOutcomeBands) ||
    response.bufferOutcomeBands.length > 61
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  let nextMinimum = 0;
  // ensure every returned buffer band is bounded and contiguous
  for (const band of response.bufferOutcomeBands) {
    // reject gaps, overlap and malformed nested selections
    if (
      !hasKeys(band, [
        "minimumBufferMinutes",
        "maximumBufferMinutes",
        "outcome",
      ]) ||
      !Number.isInteger(band.minimumBufferMinutes) ||
      !Number.isInteger(band.maximumBufferMinutes) ||
      band.minimumBufferMinutes !== nextMinimum ||
      band.maximumBufferMinutes < band.minimumBufferMinutes ||
      band.maximumBufferMinutes > 60 ||
      !isOutcome(band.outcome)
    ) {
      throw new Error("Sailing estimate unavailable");
    }
    nextMinimum = band.maximumBufferMinutes + 1;
  }
  // require full coverage for successful routed responses
  if (
    (response.bufferOutcomeBands.length > 0 &&
      (nextMinimum !== 61 ||
        response.arrivalAt === null ||
        response.durationSeconds === null ||
        response.revision === null)) ||
    (response.bufferOutcomeBands.length === 0 && response.arrivalAt !== null)
  ) {
    throw new Error("Sailing estimate unavailable");
  }
  // bind every new selected outcome to the same unique assessment snapshot
  if (response.sailingAssessments !== undefined) {
    const ids = new Set(
      response.sailingAssessments.map((sailing) => sailing.sailingId)
    );
    const selections = [
      response.outcome,
      ...response.bufferOutcomeBands.map((band) => band.outcome),
    ];
    // reject missing identities instead of falling back to ambiguous timestamps
    if (
      selections.some(
        (outcome) =>
          outcome.sailing !== null &&
          (outcome.sailing.sailingId === undefined ||
            !ids.has(outcome.sailing.sailingId))
      )
    ) {
      throw new Error("Sailing estimate unavailable");
    }
  }
  return response;
};
