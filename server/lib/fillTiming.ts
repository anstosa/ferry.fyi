import type { FillTimingCapacity } from "shared/contracts/sailingRecommendations";

export const MODEL_VERSION = "fill-linear-v1" as const;
export const ANCHOR_FRESHNESS_SECONDS = 180;
export const SEGMENT_GAP_SECONDS = 5 * 60;
export const LIVE_WINDOW_MINUTES = 15;
export const MIN_LIVE_OBSERVATIONS = 3;
export const MIN_LIVE_SPAN_MINUTES = 2;
export const MEDIUM_CONFIDENCE_SPAN_MINUTES = 5;
export const MAX_LIVE_WEIGHT = 0.8;
export const LIVE_FRESHNESS_DECAY_MINUTES = 5;
export const DEFAULT_FILL_LEAD_MINUTES = 10;
export const MIN_FILL_HORIZON_MINUTES = 3;
export const PRIOR_RATE_RANGE_RATIO = 0.5;
export const RATE_CAP_MINIMUM = 1;
export const RATE_CAP_MAXIMUM_FRACTION = 0.2;

export type CapacityReportingState =
  | "active"
  | "inactive-all-open"
  | "hidden"
  | "unknown";

export interface FillTimingObservation {
  allocationGroupId?: string | null;
  departureTime: number;
  driveUpDisplayed: boolean;
  driveUpSpaces: number | null;
  isCancelled: boolean;
  maxSpaceCount: number | null;
  pollId?: string;
  receivedAt: number;
  reportingStateAtReceipt: CapacityReportingState;
  sourceKind: "wsf-direct" | "repair-derived";
  usableForFillLabel: boolean;
  vesselId: string | null;
}

export interface PredictFillTimingInput {
  arrivalAt: number;
  asOf: number;
  departureEstimate: number | null;
  observations: FillTimingObservation[];
  projectedDepartureAt: number;
}

export interface FillTimingRateDistribution {
  anchorAt: number;
  spacesAtAnchor: number;
  minimum: number;
  mostLikely: number;
  maximum: number;
}

interface RateEstimate {
  confidence: "low" | "medium";
  high: number;
  low: number;
  priorKind: FillTimingCapacity["priorKind"];
  rate: number;
}

// build the stable unavailable result
const unavailableResult = (): FillTimingCapacity => ({
  anchorAgeSeconds: null,
  anchorAt: null,
  confidence: "low",
  fillAt: null,
  fillRange: null,
  modelVersion: MODEL_VERSION,
  observedSpacesAtAnchor: null,
  predictedSpacesAtArrival: null,
  priorKind: null,
  state: "unavailable",
});

// clamp one finite number
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

// compute a numeric median
const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  // average the middle pair
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

// reject observations that cannot anchor a curve
const isUsableDirectObservation = (
  observation: FillTimingObservation
): boolean =>
  observation.sourceKind === "wsf-direct" &&
  observation.driveUpDisplayed &&
  Number.isFinite(observation.driveUpSpaces) &&
  (observation.driveUpSpaces as number) >= 0 &&
  !observation.isCancelled &&
  (observation.reportingStateAtReceipt === "active" ||
    observation.reportingStateAtReceipt === "inactive-all-open");

// identify the same physical poll allocation
const observationIdentity = (observation: FillTimingObservation): string =>
  observation.pollId && observation.allocationGroupId
    ? `${observation.pollId}:${observation.allocationGroupId}`
    : `${observation.receivedAt}:${observation.allocationGroupId ?? "none"}`;

// select the latest uninterrupted availability segment
const selectValidSegment = (
  observations: FillTimingObservation[],
  asOf: number,
  projectedDepartureAt: number
): FillTimingObservation[] => {
  const seen = new Set<string>();
  const ordered = observations
    .filter(
      (observation) =>
        Number.isFinite(observation.receivedAt) &&
        observation.receivedAt <= asOf &&
        observation.receivedAt < projectedDepartureAt
    )
    .sort((left, right) => left.receivedAt - right.receivedAt)
    .filter((observation) => {
      const identity = observationIdentity(observation);
      // deduplicate physical allocations
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    });
  let segment: FillTimingObservation[] = [];
  // reset across every causal boundary
  for (const observation of ordered) {
    // invalid rows end the current segment
    if (!isUsableDirectObservation(observation)) {
      segment = [];
      continue;
    }
    const previous = segment[segment.length - 1];
    // begin the first valid segment
    if (!previous) {
      segment = [observation];
      continue;
    }
    const changedVessel = previous.vesselId !== observation.vesselId;
    const changedCapacity =
      previous.maxSpaceCount !== observation.maxSpaceCount;
    const exceededGap =
      observation.receivedAt - previous.receivedAt > SEGMENT_GAP_SECONDS;
    const reopened =
      (observation.driveUpSpaces as number) >
      (previous.driveUpSpaces as number);
    // start over after a segment break
    if (changedVessel || changedCapacity || exceededGap || reopened) {
      segment = [observation];
      continue;
    }
    segment.push(observation);
  }
  return segment;
};

// compute all pairwise depletion rates
const pairwiseRates = (observations: FillTimingObservation[]): number[] => {
  const rates: number[] = [];
  // compare each older observation
  for (let olderIndex = 0; olderIndex < observations.length; olderIndex += 1) {
    // compare each later observation
    for (
      let newerIndex = olderIndex + 1;
      newerIndex < observations.length;
      newerIndex += 1
    ) {
      const older = observations[olderIndex];
      const newer = observations[newerIndex];
      const minutes = (newer.receivedAt - older.receivedAt) / 60;
      // ignore coincident receipts
      if (minutes <= 0) {
        continue;
      }
      rates.push(
        ((older.driveUpSpaces as number) - (newer.driveUpSpaces as number)) /
          minutes
      );
    }
  }
  return rates;
};

// derive the prior and robust live rate
const estimateRate = (
  segment: FillTimingObservation[],
  anchor: FillTimingObservation,
  asOf: number,
  departureEstimate: number | null,
  projectedDepartureAt: number
): RateEstimate | null => {
  const anchorSpaces = anchor.driveUpSpaces as number;
  const segmentMaximum = Math.max(
    anchorSpaces,
    ...segment.map((observation) => observation.driveUpSpaces as number)
  );
  const rateCap = Math.max(
    RATE_CAP_MINIMUM,
    RATE_CAP_MAXIMUM_FRACTION * segmentMaximum
  );
  const departureMinutes = (projectedDepartureAt - anchor.receivedAt) / 60;
  let priorRate: number | null = null;
  let priorKind: FillTimingCapacity["priorKind"] = null;
  // discard departure priors contradicted by the fresher space count
  if (
    Number.isFinite(departureEstimate) &&
    (departureEstimate as number) >= 0 &&
    (departureEstimate as number) <= anchorSpaces &&
    departureMinutes > 0
  ) {
    // use the positive departure point
    if ((departureEstimate as number) > 0) {
      priorRate = Math.max(
        0,
        (anchorSpaces - (departureEstimate as number)) / departureMinutes
      );
      priorKind = "departure-point";
    } else {
      const priorFillAt = Math.min(
        projectedDepartureAt,
        Math.max(
          projectedDepartureAt - DEFAULT_FILL_LEAD_MINUTES * 60,
          anchor.receivedAt + MIN_FILL_HORIZON_MINUTES * 60
        )
      );
      const priorMinutes = (priorFillAt - anchor.receivedAt) / 60;
      priorRate = clamp(anchorSpaces / priorMinutes, 0, rateCap);
      priorKind = "zero-prior";
    }
  }

  const liveWindowStart = anchor.receivedAt - LIVE_WINDOW_MINUTES * 60;
  const liveObservations =
    anchor.reportingStateAtReceipt === "active"
      ? segment.filter(
          (observation) =>
            observation.reportingStateAtReceipt === "active" &&
            observation.receivedAt >= liveWindowStart
        )
      : [];
  const distinctReceipts = new Set(
    liveObservations.map((observation) => observation.receivedAt)
  );
  const liveSpanMinutes = liveObservations.length
    ? (anchor.receivedAt - liveObservations[0].receivedAt) / 60
    : 0;
  const hasLiveRate =
    distinctReceipts.size >= MIN_LIVE_OBSERVATIONS &&
    liveSpanMinutes >= MIN_LIVE_SPAN_MINUTES;
  let liveRate: number | null = null;
  let liveMad = 0;
  // compute the robust slope only with enough active evidence
  if (hasLiveRate) {
    const rates = pairwiseRates(liveObservations);
    const rawLiveRate = median(rates);
    liveRate = clamp(rawLiveRate, 0, rateCap);
    liveMad = median(rates.map((rate) => Math.abs(rate - rawLiveRate)));
  }
  // require at least one causal component
  if (priorRate === null && liveRate === null) {
    return null;
  }
  const freshnessMinutes = (asOf - anchor.receivedAt) / 60;
  const liveWeight =
    liveRate === null
      ? 0
      : Math.min(MAX_LIVE_WEIGHT, liveSpanMinutes / LIVE_WINDOW_MINUTES) *
        Math.exp(-freshnessMinutes / LIVE_FRESHNESS_DECAY_MINUTES);
  let rate: number;
  // use a prior-only rate
  if (liveRate === null) {
    rate = priorRate as number;
  } else if (priorRate === null) {
    // use a live-only rate
    rate = liveRate;
  } else {
    rate = liveWeight * liveRate + (1 - liveWeight) * priorRate;
  }
  let uncertainty: number;
  // widen a prior-only result
  if (liveRate === null) {
    uncertainty = Math.abs(rate) * PRIOR_RATE_RANGE_RATIO;
  } else if (priorRate === null) {
    // retain robust live dispersion
    uncertainty = liveMad;
  } else {
    uncertainty =
      liveWeight * liveMad +
      (1 - liveWeight) * Math.abs(priorRate) * PRIOR_RATE_RANGE_RATIO;
  }
  return {
    confidence:
      hasLiveRate && liveSpanMinutes >= MEDIUM_CONFIDENCE_SPAN_MINUTES
        ? "medium"
        : "low",
    high: clamp(rate + uncertainty, 0, rateCap),
    low: clamp(rate - uncertainty, 0, rateCap),
    priorKind: priorRate === null ? "live-only" : priorKind,
    rate: clamp(rate, 0, rateCap),
  };
};

// map a rate to a bounded pre-departure fill time
const fillAtForRate = (
  anchorAt: number,
  spaces: number,
  rate: number,
  projectedDepartureAt: number
): number | null => {
  // reject flat curves
  if (rate <= 0) {
    return null;
  }
  const fillAt = anchorAt + (spaces / rate) * 60;
  return fillAt <= projectedDepartureAt ? fillAt : null;
};

// expose the same causal rate estimate without changing the fill prediction
export const getFillTimingRateDistribution = ({
  arrivalAt,
  asOf,
  departureEstimate,
  observations,
  projectedDepartureAt,
}: PredictFillTimingInput): FillTimingRateDistribution | null => {
  // enforce the prediction's input and departure boundary
  if (
    !Number.isFinite(asOf) ||
    !Number.isFinite(arrivalAt) ||
    !Number.isFinite(projectedDepartureAt) ||
    projectedDepartureAt <= asOf
  ) {
    return null;
  }
  const segment = selectValidSegment(observations, asOf, projectedDepartureAt);
  const anchor = segment[segment.length - 1];
  // require the same fresh direct anchor
  if (!anchor) {
    return null;
  }
  const anchorAgeSeconds = asOf - anchor.receivedAt;
  // reject stale or future evidence
  if (anchorAgeSeconds < 0 || anchorAgeSeconds > ANCHOR_FRESHNESS_SECONDS) {
    return null;
  }
  const spacesAtAnchor = anchor.driveUpSpaces as number;
  // leave observed zero to the deterministic already-full state
  if (spacesAtAnchor === 0) {
    return null;
  }
  const estimate = estimateRate(
    segment,
    anchor,
    asOf,
    departureEstimate,
    projectedDepartureAt
  );
  // require the same usable prior or live rate
  if (!estimate) {
    return null;
  }
  return {
    anchorAt: anchor.receivedAt,
    spacesAtAnchor,
    minimum: estimate.low,
    mostLikely: estimate.rate,
    maximum: estimate.high,
  };
};

// predict literal zero drive-up timing from one causal snapshot
export const predictFillTiming = ({
  arrivalAt,
  asOf,
  departureEstimate,
  observations,
  projectedDepartureAt,
}: PredictFillTimingInput): FillTimingCapacity => {
  // reject departed or invalid sailings
  if (
    !Number.isFinite(asOf) ||
    !Number.isFinite(arrivalAt) ||
    !Number.isFinite(projectedDepartureAt) ||
    projectedDepartureAt <= asOf
  ) {
    return unavailableResult();
  }
  const segment = selectValidSegment(observations, asOf, projectedDepartureAt);
  const anchor = segment[segment.length - 1];
  // require one current direct anchor
  if (!anchor) {
    return unavailableResult();
  }
  const anchorAgeSeconds = asOf - anchor.receivedAt;
  // enforce causal freshness
  if (anchorAgeSeconds < 0 || anchorAgeSeconds > ANCHOR_FRESHNESS_SECONDS) {
    return unavailableResult();
  }
  const anchorSpaces = anchor.driveUpSpaces as number;
  const base = {
    anchorAgeSeconds,
    anchorAt: anchor.receivedAt,
    confidence: "low" as const,
    modelVersion: MODEL_VERSION,
    observedSpacesAtAnchor: anchorSpaces,
  };
  // trust zero only during active direct reporting
  if (
    anchorSpaces === 0 &&
    anchor.reportingStateAtReceipt === "active" &&
    anchor.usableForFillLabel
  ) {
    let lastPositiveAt: number | null = null;
    // retain the closest positive lower bound
    for (let index = segment.length - 2; index >= 0; index -= 1) {
      const previous = segment[index];
      // stop at the nearest positive receipt
      if ((previous.driveUpSpaces as number) > 0) {
        lastPositiveAt = previous.receivedAt;
        break;
      }
    }
    return {
      ...base,
      fillAt: null,
      fillRange: {
        earliest: lastPositiveAt,
        latest: anchor.receivedAt,
      },
      predictedSpacesAtArrival: 0,
      priorKind: null,
      state: "already-full",
    };
  }
  // reject placeholder zeroes
  if (anchorSpaces === 0) {
    return unavailableResult();
  }
  const rateEstimate = estimateRate(
    segment,
    anchor,
    asOf,
    departureEstimate,
    projectedDepartureAt
  );
  // require a usable rate
  if (!rateEstimate) {
    return unavailableResult();
  }
  const { confidence, high, low, priorKind, rate } = rateEstimate;
  const fillAt = fillAtForRate(
    anchor.receivedAt,
    anchorSpaces,
    rate,
    projectedDepartureAt
  );
  const predictedSpacesAtArrival = Math.max(
    0,
    anchorSpaces -
      (rate * (Math.max(anchor.receivedAt, arrivalAt) - anchor.receivedAt)) / 60
  );
  const fillRange = fillAt
    ? {
        earliest: fillAtForRate(
          anchor.receivedAt,
          anchorSpaces,
          high,
          projectedDepartureAt
        ),
        latest: fillAtForRate(
          anchor.receivedAt,
          anchorSpaces,
          low,
          projectedDepartureAt
        ),
      }
    : null;
  // distinguish extrapolated exhaustion from observed zero
  if (fillAt !== null && fillAt <= asOf) {
    return {
      ...base,
      confidence,
      fillAt,
      fillRange,
      predictedSpacesAtArrival: 0,
      priorKind,
      state: "predicted-full-by-now",
    };
  }
  // report curves that stay positive through departure
  if (fillAt === null) {
    return {
      ...base,
      confidence,
      fillAt: null,
      fillRange: null,
      predictedSpacesAtArrival,
      priorKind,
      state: "not-expected-before-departure",
    };
  }
  return {
    ...base,
    confidence,
    fillAt,
    fillRange,
    predictedSpacesAtArrival,
    priorKind,
    state: "available",
  };
};
