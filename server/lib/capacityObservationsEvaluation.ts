import { percentile, rate } from "shared/lib/observability";

import {
  type FillTimingObservation,
  predictFillTiming,
  type PredictFillTimingInput,
  SEGMENT_GAP_SECONDS,
} from "~/lib/fillTiming";

export type CapacityFillLabel =
  | {
      firstZeroAt: number;
      kind: "interval-censored";
      lastPositiveAt: number;
    }
  | { firstObservationAt: number; kind: "already-full-by-first-observation" }
  | { kind: "not-observed-full"; lastObservationAt: number }
  | { kind: "right-censored-early"; lastObservationAt: number }
  | { kind: "reopened"; reopenedAt: number };

export type CapacityObservationExclusionReason =
  | "cancelled"
  | "capacity-change"
  | "duplicate"
  | "gap"
  | "hidden"
  | "inactive-all-open"
  | "invalid"
  | "post-departure"
  | "repair-derived"
  | "reopened"
  | "unknown"
  | "unusable"
  | "vessel-change";

export interface CapacityFillLabelDerivation {
  exclusionReasons: Partial<Record<CapacityObservationExclusionReason, number>>;
  label: CapacityFillLabel | null;
}

export interface FillTimingEvaluationCase extends PredictFillTimingInput {
  daypart?: string;
  route?: string;
}

export interface FillTimingEvaluationReport {
  cohorts: Record<string, number>;
  eligible: number;
  eventBeforeDeparture: {
    accuracy: number | null;
    falseNegative: number;
    falsePositive: number;
    precision: number | null;
    recall: number | null;
    trueNegative: number;
    truePositive: number;
  };
  excluded: Record<string, number>;
  falseAvailableAtFixedHorizon: number;
  intervalErrorSeconds: { median: number | null; p90: number | null };
  modelVersion: "fill-linear-v1";
  observationExclusions: Partial<
    Record<CapacityObservationExclusionReason, number>
  >;
  predictedRangeCoverage: number | null;
  predictedRangeIntersection: number | null;
  total: number;
  validationClaim: "deterministic-baseline-only";
}

// explain why one raw row cannot label a fill event
const getObservationExclusionReason = (
  observation: FillTimingObservation,
  projectedDepartureAt: number
): CapacityObservationExclusionReason | null => {
  // exclude causally late receipts
  if (observation.receivedAt >= projectedDepartureAt) {
    return "post-departure";
  }
  // exclude synthetic repairs
  if (observation.sourceKind !== "wsf-direct") {
    return "repair-derived";
  }
  // end segments across cancellation
  if (observation.isCancelled) {
    return "cancelled";
  }
  // end segments across hidden inventory
  if (!observation.driveUpDisplayed) {
    return "hidden";
  }
  // preserve reporting-state boundaries
  if (observation.reportingStateAtReceipt !== "active") {
    return observation.reportingStateAtReceipt;
  }
  // reject malformed counts
  if (
    !Number.isFinite(observation.driveUpSpaces) ||
    (observation.driveUpSpaces as number) < 0
  ) {
    return "invalid";
  }
  // require ingestion eligibility
  if (!observation.usableForFillLabel) {
    return "unusable";
  }
  return null;
};

// increment one bounded exclusion reason
const addExclusionReason = (
  reasons: Partial<Record<CapacityObservationExclusionReason, number>>,
  reason: CapacityObservationExclusionReason
): void => {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
};

// derive one label without bridging invalid boundaries
export const deriveCapacityFillLabelResult = (
  observations: FillTimingObservation[],
  projectedDepartureAt: number
): CapacityFillLabelDerivation => {
  const exclusionReasons: Partial<
    Record<CapacityObservationExclusionReason, number>
  > = {};
  const seen = new Set<string>();
  const ordered = [...observations].sort(
    (left, right) => left.receivedAt - right.receivedAt
  );
  let segment: FillTimingObservation[] = [];
  let reopenedAt: number | null = null;
  // walk raw rows so invalid observations remain boundaries
  for (const observation of ordered) {
    const identity = `${observation.pollId ?? observation.receivedAt}:${observation.allocationGroupId ?? "none"}`;
    // ignore duplicated physical allocations
    if (seen.has(identity)) {
      addExclusionReason(exclusionReasons, "duplicate");
      continue;
    }
    seen.add(identity);
    const exclusionReason = getObservationExclusionReason(
      observation,
      projectedDepartureAt
    );
    // end the segment at invalid predeparture evidence
    if (exclusionReason) {
      addExclusionReason(exclusionReasons, exclusionReason);
      // postdeparture evidence cannot invalidate an earlier label
      if (exclusionReason !== "post-departure") {
        segment = [];
      }
      continue;
    }
    const previous = segment[segment.length - 1];
    // begin the first valid segment
    if (!previous) {
      segment = [observation];
      continue;
    }
    // reset after a reporting gap
    if (observation.receivedAt - previous.receivedAt > SEGMENT_GAP_SECONDS) {
      addExclusionReason(exclusionReasons, "gap");
      segment = [observation];
      continue;
    }
    // reset after a vessel boundary
    if (observation.vesselId !== previous.vesselId) {
      addExclusionReason(exclusionReasons, "vessel-change");
      segment = [observation];
      continue;
    }
    // reset after a combined-capacity boundary
    if (observation.maxSpaceCount !== previous.maxSpaceCount) {
      addExclusionReason(exclusionReasons, "capacity-change");
      segment = [observation];
      continue;
    }
    // reset after any availability increase
    if (
      (observation.driveUpSpaces as number) > (previous.driveUpSpaces as number)
    ) {
      addExclusionReason(exclusionReasons, "reopened");
      // preserve an explicit zero-to-positive reopening label
      if (previous.driveUpSpaces === 0) {
        reopenedAt = observation.receivedAt;
      }
      segment = [observation];
      continue;
    }
    segment.push(observation);
  }
  // exclude a reopened permanent-first-fill episode
  if (reopenedAt !== null) {
    return {
      exclusionReasons,
      label: { kind: "reopened", reopenedAt },
    };
  }
  const first = segment[0];
  // require one valid segment
  if (!first) {
    return { exclusionReasons, label: null };
  }
  // preserve left censoring
  if (first.driveUpSpaces === 0) {
    return {
      exclusionReasons,
      label: {
        firstObservationAt: first.receivedAt,
        kind: "already-full-by-first-observation",
      },
    };
  }
  let lastPositive = first;
  let firstZero: FillTimingObservation | null = null;
  // find the zero bound inside the valid segment
  for (const observation of segment.slice(1)) {
    // capture the first reported zero
    if (!firstZero && observation.driveUpSpaces === 0) {
      firstZero = observation;
      continue;
    }
    // retain the latest positive bound
    if (!firstZero && (observation.driveUpSpaces as number) > 0) {
      lastPositive = observation;
    }
  }
  // return an observed interval
  if (firstZero) {
    return {
      exclusionReasons,
      label: {
        firstZeroAt: firstZero.receivedAt,
        kind: "interval-censored",
        lastPositiveAt: lastPositive.receivedAt,
      },
    };
  }
  const lastObservationAt =
    segment[segment.length - 1]?.receivedAt ?? first.receivedAt;
  return {
    exclusionReasons,
    label: {
      // require outcome coverage within the existing observation-gap tolerance
      kind:
        projectedDepartureAt - lastObservationAt > SEGMENT_GAP_SECONDS
          ? "right-censored-early"
          : "not-observed-full",
      lastObservationAt,
    },
  };
};

// derive a censor-aware label for one sailing
export const deriveCapacityFillLabel = (
  observations: FillTimingObservation[],
  projectedDepartureAt: number
): CapacityFillLabel | null =>
  deriveCapacityFillLabelResult(observations, projectedDepartureAt).label;

// measure point distance from an event interval
export const getFillIntervalErrorSeconds = (
  predictedFillAt: number,
  label: Extract<CapacityFillLabel, { kind: "interval-censored" }>
): number => {
  // measure early predictions
  if (predictedFillAt < label.lastPositiveAt) {
    return label.lastPositiveAt - predictedFillAt;
  }
  // measure late predictions
  if (predictedFillAt > label.firstZeroAt) {
    return predictedFillAt - label.firstZeroAt;
  }
  return 0;
};

// evaluate deterministic causal cases
export const evaluateFillTimingCases = (
  cases: FillTimingEvaluationCase[]
): FillTimingEvaluationReport => {
  const cohorts: Record<string, number> = {};
  const excluded: Record<string, number> = {};
  const observationExclusions: Partial<
    Record<CapacityObservationExclusionReason, number>
  > = {};
  const intervalErrors: number[] = [];
  let eligible = 0;
  let coveredRanges = 0;
  let intersectingRanges = 0;
  let rangedPredictions = 0;
  let falseAvailableAtFixedHorizon = 0;
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  // replay each issue-time snapshot independently
  for (const evaluationCase of cases) {
    const causalObservations = evaluationCase.observations.filter(
      (observation) => observation.receivedAt <= evaluationCase.asOf
    );
    const labelResult = deriveCapacityFillLabelResult(
      evaluationCase.observations,
      evaluationCase.projectedDepartureAt
    );
    const { label } = labelResult;
    // aggregate raw-row exclusion evidence
    for (const [reason, count] of Object.entries(
      labelResult.exclusionReasons
    )) {
      observationExclusions[reason as CapacityObservationExclusionReason] =
        (observationExclusions[reason as CapacityObservationExclusionReason] ??
          0) + (count ?? 0);
    }
    // exclude outcomes without enough coverage to establish a non-event
    if (
      !label ||
      label.kind === "reopened" ||
      label.kind === "right-censored-early"
    ) {
      const reason = label?.kind ?? "no-label";
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      continue;
    }
    const prediction = predictFillTiming({
      ...evaluationCase,
      observations: causalObservations,
    });
    // exclude unavailable issue snapshots
    if (prediction.state === "unavailable") {
      excluded["prediction-unavailable"] =
        (excluded["prediction-unavailable"] ?? 0) + 1;
      continue;
    }
    eligible += 1;
    const cohort = `${evaluationCase.route ?? "unknown-route"}:${evaluationCase.daypart ?? "unknown-daypart"}`;
    cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
    // score point timing only against an observed interval
    if (prediction.fillAt !== null && label.kind === "interval-censored") {
      intervalErrors.push(
        getFillIntervalErrorSeconds(prediction.fillAt, label)
      );
    }
    // score range intersection with the observed interval
    if (prediction.fillRange && label.kind === "interval-censored") {
      rangedPredictions += 1;
      const earliest = prediction.fillRange.earliest ?? -Infinity;
      const latest = prediction.fillRange.latest ?? Infinity;
      // count intersecting intervals
      if (earliest <= label.firstZeroAt && latest >= label.lastPositiveAt) {
        intersectingRanges += 1;
      }
      // count complete interval coverage
      if (earliest <= label.lastPositiveAt && latest >= label.firstZeroAt) {
        coveredRanges += 1;
      }
    }
    const actualEvent = label.kind !== "not-observed-full";
    const predictedEvent =
      prediction.state === "already-full" ||
      prediction.state === "predicted-full-by-now" ||
      (prediction.fillAt !== null &&
        prediction.fillAt <= evaluationCase.projectedDepartureAt);
    // populate the deterministic confusion matrix
    if (actualEvent && predictedEvent) {
      truePositive += 1;
    } else if (!actualEvent && !predictedEvent) {
      trueNegative += 1;
    } else if (!actualEvent && predictedEvent) {
      falsePositive += 1;
    } else {
      falseNegative += 1;
    }
    const observedFullByTarget =
      (label.kind === "interval-censored" &&
        label.firstZeroAt <= evaluationCase.arrivalAt) ||
      (label.kind === "already-full-by-first-observation" &&
        label.firstObservationAt <= evaluationCase.arrivalAt);
    // flag false availability at the fixed arrival horizon
    if (
      (prediction.predictedSpacesAtArrival ?? 0) > 0 &&
      observedFullByTarget
    ) {
      falseAvailableAtFixedHorizon += 1;
    }
  }
  const classified =
    truePositive + trueNegative + falsePositive + falseNegative;
  return {
    cohorts,
    eligible,
    eventBeforeDeparture: {
      accuracy: rate(truePositive + trueNegative, classified),
      falseNegative,
      falsePositive,
      precision: rate(truePositive, truePositive + falsePositive),
      recall: rate(truePositive, truePositive + falseNegative),
      trueNegative,
      truePositive,
    },
    excluded,
    falseAvailableAtFixedHorizon,
    intervalErrorSeconds: {
      median: percentile(intervalErrors, 0.5),
      p90: percentile(intervalErrors, 0.9),
    },
    modelVersion: "fill-linear-v1",
    observationExclusions,
    predictedRangeCoverage: rate(coveredRanges, rangedPredictions),
    predictedRangeIntersection: rate(intersectingRanges, rangedPredictions),
    total: cases.length,
    validationClaim: "deterministic-baseline-only",
  };
};
