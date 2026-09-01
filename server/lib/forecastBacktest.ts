import { createHash } from "node:crypto";

import { DateTime } from "luxon";

import type { DemandShockCrossing } from "~/lib/forecastDemandShock";
import { DEMAND_SHOCK_REGRESSION_THRESHOLDS } from "~/lib/forecastRegressionThresholds";

export const BACKTEST_TIME_ZONE = "America/Los_Angeles";
export const DEFAULT_BACKTEST_LEAD_MINUTES = 30;
export const STRICT_FULL_AVAILABLE_THRESHOLD = 0.02;
export const PRACTICAL_FULL_AVAILABLE_THRESHOLD = 0.1;

export interface BacktestCrossing extends DemandShockCrossing {
  hasReservations: boolean;
  id?: number | string;
}

export interface BinaryForecastStats {
  actualNegative: number;
  actualPositive: number;
  brierTotal: number;
  count: number;
  falsePositive: number;
  predictedPositive: number;
  truePositive: number;
}

export interface BinaryForecastReport {
  brier: number;
  falseFullRate: number;
  precision: number;
  recall: number;
}

export interface BacktestMetricSnapshot {
  coherenceViolationRate: number;
  highMissRate: number;
  lowMissRate: number;
  mae: number;
  p90: number;
  practicalFull: BinaryForecastReport;
  strictFull: BinaryForecastReport;
}

export interface BacktestComparisonGateOptions {
  requireNoWorseMissRates?: boolean;
}

export interface BacktestEstimatorInputAudit {
  arrivalId: string;
  asOf: number;
  departureId: string;
  samples: Array<{
    arrivalId: string;
    departureId: string;
    departureTime: number;
    driveUpCapacity: number;
    id: number | string | null;
    normalizedDriveUpCapacity: number;
    normalizedReservableCapacity: number | null;
    reservableCapacity: number | null;
    totalCapacity: number;
    weight: number;
  }>;
  targetCapacity: number;
  targetDepartureTime: number;
  targetId: number | string;
}

export type ComparableHistoryIndex = Map<
  string,
  Map<number, BacktestCrossing[]>
>;
export type ShockHistoryIndex = Map<string, BacktestCrossing[]>;

// identify one direction
export const getBacktestPairKey = (
  crossing: Pick<BacktestCrossing, "arrivalId" | "departureId">
): string => `${crossing.departureId}-${crossing.arrivalId}`;

// parse and validate lead minutes
export const parseBacktestLeadMinutes = (value: string | null): number => {
  // use the documented lead
  if (value === null) {
    return DEFAULT_BACKTEST_LEAD_MINUTES;
  }
  const leadMinutes = Number(value);
  // reject invalid leads
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new Error(`Invalid lead minutes: ${value}`);
  }
  return leadMinutes;
};

// calculate a leak-free Pacific as-of instant
export const getBacktestAsOf = (
  targetDepartureTime: number,
  leadMinutes: number
): DateTime => {
  // reject invalid leads
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new Error(`Invalid lead minutes: ${leadMinutes}`);
  }
  return DateTime.fromSeconds(targetDepartureTime, {
    zone: BACKTEST_TIME_ZONE,
  }).minus({ minutes: leadMinutes });
};

// build the exact pair/hour candidate index
export const buildComparableHistoryIndex = (
  crossings: BacktestCrossing[]
): ComparableHistoryIndex => {
  const index: ComparableHistoryIndex = new Map();
  // index every crossing
  crossings.forEach((crossing) => {
    const pair = getBacktestPairKey(crossing);
    const { hour } = DateTime.fromSeconds(crossing.departureTime, {
      zone: BACKTEST_TIME_ZONE,
    });
    const hourIndex = index.get(pair) ?? new Map<number, BacktestCrossing[]>();
    hourIndex.set(hour, [...(hourIndex.get(hour) ?? []), crossing]);
    index.set(pair, hourIndex);
  });
  // stabilize every hour bucket
  index.forEach((hourIndex) => {
    hourIndex.forEach((bucket, hour) => {
      hourIndex.set(
        hour,
        [...bucket].sort((left, right) => {
          // preserve stable chronological order
          return left.departureTime - right.departureTime;
        })
      );
    });
  });
  return index;
};

// build the untruncated direction-history index
export const buildShockHistoryIndex = (
  crossings: BacktestCrossing[]
): ShockHistoryIndex => {
  const index: ShockHistoryIndex = new Map();
  // collect every direction row
  crossings.forEach((crossing) => {
    const pair = getBacktestPairKey(crossing);
    index.set(pair, [...(index.get(pair) ?? []), crossing]);
  });
  // stabilize each direction history
  index.forEach((rows, pair) => {
    index.set(
      pair,
      [...rows].sort((left, right) => {
        // preserve stable chronological order
        return left.departureTime - right.departureTime;
      })
    );
  });
  return index;
};

// locate the first row at or after one cutoff
export const getBacktestPriorIndex = (
  crossings: BacktestCrossing[],
  asOf: number
): number => {
  let low = 0;
  let high = crossings.length;
  // find the strict cutoff
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    // search the upper half
    if (crossings[middle].departureTime < asOf) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

// select exact max-limited comparable candidates
export const getBacktestComparableCandidates = (
  target: BacktestCrossing,
  historyIndex: ComparableHistoryIndex,
  maxCandidates: number,
  asOf: number
): BacktestCrossing[] => {
  const targetTime = DateTime.fromSeconds(target.departureTime, {
    zone: BACKTEST_TIME_ZONE,
  });
  const pairIndex = historyIndex.get(getBacktestPairKey(target));
  // require a direction index
  if (!pairIndex) {
    return [];
  }
  const candidates: BacktestCrossing[] = [];
  // scan the existing nearby-hour buckets
  for (let hourOffset = -2; hourOffset <= 2; hourOffset += 1) {
    const hour = (targetTime.hour + hourOffset + 24) % 24;
    const bucket = pairIndex.get(hour) ?? [];
    const priorIndex = getBacktestPriorIndex(bucket, asOf);
    candidates.push(
      ...bucket.slice(Math.max(0, priorIndex - maxCandidates), priorIndex)
    );
  }
  return candidates;
};

// return every same-direction row before as-of
export const getShockHistoryBeforeAsOf = (
  target: BacktestCrossing,
  historyIndex: ShockHistoryIndex,
  asOf: number
): BacktestCrossing[] => {
  const rows = historyIndex.get(getBacktestPairKey(target)) ?? [];
  return rows.slice(0, getBacktestPriorIndex(rows, asOf));
};

// fingerprint exact comparable row values and order
export const getComparableHistoryDigest = (
  crossings: BacktestCrossing[]
): string => {
  const identities = crossings.map((crossing) => {
    return [
      crossing.id ?? "",
      crossing.departureId,
      crossing.arrivalId,
      crossing.departureTime,
      crossing.totalCapacity,
      crossing.driveUpCapacity,
      crossing.reservableCapacity,
    ].join(":");
  });
  return createHash("sha256").update(identities.join("|")).digest("hex");
};

// fingerprint one actual estimator invocation
export const getBacktestEstimatorInputDigest = (
  audit: BacktestEstimatorInputAudit
): string => createHash("sha256").update(JSON.stringify(audit)).digest("hex");

// identify the strict two-percent event
export const isStrictFullEvent = (
  availableCapacity: number,
  totalCapacity: number
): boolean =>
  totalCapacity > 0 &&
  availableCapacity / totalCapacity <= STRICT_FULL_AVAILABLE_THRESHOLD;

// identify the client-equivalent practical event
export const isPracticalFullEvent = (
  availableCapacity: number,
  totalCapacity: number
): boolean =>
  totalCapacity > 0 &&
  (availableCapacity === 0 ||
    availableCapacity / totalCapacity < PRACTICAL_FULL_AVAILABLE_THRESHOLD);

// create one binary metric accumulator
export const createBinaryForecastStats = (): BinaryForecastStats => ({
  actualNegative: 0,
  actualPositive: 0,
  brierTotal: 0,
  count: 0,
  falsePositive: 0,
  predictedPositive: 0,
  truePositive: 0,
});

// add one probability outcome
export const addBinaryForecastSample = (
  stats: BinaryForecastStats,
  actualPositive: boolean,
  probability: number
): void => {
  const boundedProbability = Math.max(0, Math.min(1, probability));
  const numericOutcome = actualPositive ? 1 : 0;
  const predictedPositive = boundedProbability >= 0.5;
  stats.count += 1;
  stats.brierTotal += (boundedProbability - numericOutcome) ** 2;
  // record the actual class
  if (actualPositive) {
    stats.actualPositive += 1;
  } else {
    stats.actualNegative += 1;
  }
  // record the predicted class
  if (predictedPositive) {
    stats.predictedPositive += 1;
  }
  // record a true positive
  if (actualPositive && predictedPositive) {
    stats.truePositive += 1;
  }
  // record a false positive
  if (!actualPositive && predictedPositive) {
    stats.falsePositive += 1;
  }
};

// serialize one binary metric family
export const toBinaryForecastReport = (
  stats: BinaryForecastStats
): BinaryForecastReport => ({
  brier: stats.count ? stats.brierTotal / stats.count : 0,
  falseFullRate: stats.actualNegative
    ? stats.falsePositive / stats.actualNegative
    : 0,
  precision: stats.predictedPositive
    ? stats.truePositive / stats.predictedPositive
    : 0,
  recall: stats.actualPositive ? stats.truePositive / stats.actualPositive : 0,
});

// detect one serving-coherence violation
export const hasForecastCoherenceViolation = (
  availableCapacity: number,
  totalCapacity: number,
  probability: number
): boolean => {
  // reject invalid probability output
  if (probability < 0 || probability > 1) {
    return true;
  }
  const availableShare =
    totalCapacity > 0 ? availableCapacity / totalCapacity : 0;
  return (
    (availableCapacity === 0 && probability < 0.5) ||
    (availableShare >= 0.1 && probability > 0.49) ||
    (availableShare > 0.35 && probability > 0.19)
  );
};

// evaluate paired candidate gates
export const getBacktestComparisonFailures = (
  baseline: BacktestMetricSnapshot,
  candidate: BacktestMetricSnapshot,
  options: BacktestComparisonGateOptions = {}
): string[] => {
  const thresholds = DEMAND_SHOCK_REGRESSION_THRESHOLDS;
  const failures: Array<string | null> = [
    candidate.mae > baseline.mae + thresholds.maeDelta
      ? `mae delta ${candidate.mae - baseline.mae} > ${thresholds.maeDelta}`
      : null,
    candidate.p90 > baseline.p90 + thresholds.p90Delta
      ? `p90 delta ${candidate.p90 - baseline.p90} > ${thresholds.p90Delta}`
      : null,
    candidate.strictFull.brier >
    baseline.strictFull.brier + thresholds.brierDelta
      ? `strict brier delta > ${thresholds.brierDelta}`
      : null,
    candidate.strictFull.recall <
    baseline.strictFull.recall + thresholds.recallDelta
      ? `strict recall delta < ${thresholds.recallDelta}`
      : null,
    candidate.strictFull.precision <
    baseline.strictFull.precision + thresholds.precisionDelta
      ? `strict precision delta < ${thresholds.precisionDelta}`
      : null,
    candidate.strictFull.falseFullRate >
    baseline.strictFull.falseFullRate + thresholds.falseFullRateDelta
      ? `strict false-full delta > ${thresholds.falseFullRateDelta}`
      : null,
    candidate.practicalFull.brier >
    baseline.practicalFull.brier + thresholds.brierDelta
      ? `practical brier delta > ${thresholds.brierDelta}`
      : null,
    candidate.practicalFull.recall <
    baseline.practicalFull.recall + thresholds.recallDelta
      ? `practical recall delta < ${thresholds.recallDelta}`
      : null,
    candidate.practicalFull.precision <
    baseline.practicalFull.precision + thresholds.precisionDelta
      ? `practical precision delta < ${thresholds.precisionDelta}`
      : null,
    candidate.practicalFull.falseFullRate >
    baseline.practicalFull.falseFullRate + thresholds.falseFullRateDelta
      ? `practical false-full delta > ${thresholds.falseFullRateDelta}`
      : null,
    candidate.coherenceViolationRate === 0
      ? null
      : `candidate coherence violation rate ${candidate.coherenceViolationRate} != 0`,
  ];
  // enforce directional miss-rate gates
  if (options.requireNoWorseMissRates) {
    failures.push(
      candidate.lowMissRate > baseline.lowMissRate
        ? "candidate low miss rate is worse"
        : null,
      candidate.highMissRate > baseline.highMissRate
        ? "candidate high miss rate is worse"
        : null
    );
  }
  return failures.filter((failure): failure is string => Boolean(failure));
};
