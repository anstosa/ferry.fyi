import { DateTime } from "luxon";
import { constrain } from "shared/lib/math";

import { getForecastDaypart } from "~/lib/forecastDaypart";

export const FORECAST_TIME_ZONE = "America/Los_Angeles";

const FINALIZATION_LAG_SECONDS = 10 * 60;
const RECENT_WINDOW_DAYS = 21;
const HISTORY_WINDOW_YEARS = 2;
const REFERENCE_HALF_LIFE_SECONDS = 180 * 24 * 60 * 60;
const RECENT_HALF_LIFE_SECONDS = 7 * 24 * 60 * 60;
const SAME_DAY_HALF_LIFE_SECONDS = 90 * 60;
const SAME_DAY_WINDOW_SECONDS = 4 * 60 * 60;
const SAME_DAY_TARGET_HORIZON_HOURS = 6;
const MIN_REFERENCE_ROWS = 20;
const MIN_REFERENCE_EFFECTIVE_SIZE = 12;
const MIN_RECENT_ROWS = 8;
const MIN_RECENT_EFFECTIVE_SIZE = 5;
const MIN_RECENT_SERVICE_DATES = 2;
const MIN_SAME_DAY_ROWS = 3;
const MAX_SAME_DAY_ROWS = 5;
const REGIME_SHRINK_PRIOR = 8;
const SAME_DAY_SHRINK_PRIOR = 3;
const MAX_REGIME_DELTA = 0.12;
const MAX_SAME_DAY_DELTA = 0.18;
const MAX_COMBINED_DELTA = 0.25;
const MIN_MATERIAL_DELTA = 0.01;

export interface DemandShockDirection {
  arrivalId: string;
  departureId: string;
}

export interface DemandShockCrossing extends DemandShockDirection {
  departureDelta?: number | null;
  departureTime: number;
  driveUpCapacity: number;
  isCancelled: boolean;
  reservableCapacity: number | null;
  totalCapacity: number;
}

export interface DemandShockIndexedCrossing {
  adjustedDepartureTime: number;
  bucket: DemandBucket;
  crossing: DemandShockCrossing;
  month: number;
}

export interface DemandShockHistoryIndex {
  rowsByBucket: Map<string, DemandShockIndexedCrossing[]>;
  rowsByDirection: Map<string, DemandShockIndexedCrossing[]>;
}

export type DemandShockHistorySource =
  | DemandShockCrossing[]
  | DemandShockHistoryIndex;

export interface DemandShockTarget extends DemandShockDirection {
  departureTime: number;
  targetCapacity: number;
}

export interface DemandShockBaseSample {
  driveUpCapacity: number;
  reservableCapacity: number | null;
  weight: number;
}

export interface DemandShockSignal {
  baseOccupiedShare: number | null;
  effectiveSampleSize: number;
  occupiedShareDelta: number;
  observedOccupiedShare: number;
  rawResidual: number;
  referenceOccupiedShare: number;
  sampleSize: number;
  targetOccupiedShare: number | null;
}

export interface DemandShockAdjustment {
  occupiedShareDelta: number;
  recentRegime: DemandShockSignal | null;
  sameDay: DemandShockSignal | null;
}

export interface DemandShockCapacityPair {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

export interface DemandShockInput {
  asOf: number;
  baseSamples: DemandShockBaseSample[];
  history: DemandShockHistorySource;
  target: DemandShockTarget;
}

export interface SameDaySignalSample {
  ageMinutes: number;
  observedOccupiedShare: number;
  referenceOccupiedShare: number;
}

interface WeightedShare {
  value: number;
  weight: number;
}

interface ReferenceStats {
  effectiveSampleSize: number;
  mean: number;
  sampleSize: number;
}

export interface DemandBucket {
  daypart: ReturnType<typeof getForecastDaypart>;
  hour: number;
  serviceDate: string;
  weekday: number;
}

// normalize one epoch into Pacific time
const toPacificTime = (seconds: number): DateTime =>
  DateTime.fromSeconds(seconds, { zone: FORECAST_TIME_ZONE });

// resolve the WSF service date in Pacific time
const getServiceDate = (time: DateTime): DateTime => {
  const pacific = time.setZone(FORECAST_TIME_ZONE);
  // shift overnight sailings to the prior service day
  if (pacific.hour < 3) {
    return pacific.minus({ days: 1 });
  }
  return pacific;
};

// constrain one finite share
const constrainShare = (value: number): number => constrain(value, 0, 1);

// calculate one weighted mean
const getWeightedMean = (values: WeightedShare[]): number | null => {
  let weightedTotal = 0;
  let totalWeight = 0;
  // accumulate valid weighted values
  values.forEach(({ value, weight }) => {
    // ignore unusable values
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      return;
    }
    weightedTotal += value * weight;
    totalWeight += weight;
  });
  return totalWeight > 0 ? weightedTotal / totalWeight : null;
};

// calculate elapsed half-life decay
export const getHalfLifeWeight = (
  ageSeconds: number,
  halfLifeSeconds: number
): number => {
  // reject invalid decay inputs
  if (
    !Number.isFinite(ageSeconds) ||
    !Number.isFinite(halfLifeSeconds) ||
    ageSeconds < 0 ||
    halfLifeSeconds <= 0
  ) {
    return 0;
  }
  return 2 ** (-ageSeconds / halfLifeSeconds);
};

// calculate effective weighted sample size
export const getEffectiveSampleSize = (weights: number[]): number => {
  let weightTotal = 0;
  let squaredWeightTotal = 0;
  // accumulate positive finite weights
  weights.forEach((weight) => {
    // ignore unusable weights
    if (!Number.isFinite(weight) || weight <= 0) {
      return;
    }
    weightTotal += weight;
    squaredWeightTotal += weight * weight;
  });
  return squaredWeightTotal > 0
    ? (weightTotal * weightTotal) / squaredWeightTotal
    : 0;
};

// normalize source occupied vehicles into target space
export const normalizeOccupiedShare = (
  source: Pick<
    DemandShockCrossing,
    "driveUpCapacity" | "reservableCapacity" | "totalCapacity"
  >,
  targetCapacity: number
): number | null => {
  // require valid source and target capacities
  if (source.totalCapacity <= 0 || targetCapacity <= 0) {
    return null;
  }
  const available = constrain(
    source.driveUpCapacity + (source.reservableCapacity ?? 0),
    0,
    source.totalCapacity
  );
  const occupiedVehicles = constrain(
    source.totalCapacity - available,
    0,
    source.totalCapacity
  );
  return constrain(occupiedVehicles, 0, targetCapacity) / targetCapacity;
};

// calculate adjusted departure time
export const getAdjustedDepartureTime = (
  crossing: Pick<DemandShockCrossing, "departureDelta" | "departureTime">
): number => crossing.departureTime + Math.max(0, crossing.departureDelta ?? 0);

// enforce direction and strict as-of eligibility
export const isDemandShockEligible = (
  crossing: DemandShockCrossing,
  direction: DemandShockDirection,
  asOf: number
): boolean => {
  // require exact direction
  if (
    crossing.departureId !== direction.departureId ||
    crossing.arrivalId !== direction.arrivalId
  ) {
    return false;
  }
  // reject cancelled or invalid outcomes
  if (crossing.isCancelled || crossing.totalCapacity <= 0) {
    return false;
  }
  return getAdjustedDepartureTime(crossing) + FINALIZATION_LAG_SECONDS < asOf;
};

// describe one Pacific demand bucket
export const getDemandBucket = (seconds: number): DemandBucket => {
  const time = toPacificTime(seconds);
  const serviceDate = getServiceDate(time);
  return {
    daypart: getForecastDaypart(time),
    hour: time.hour,
    serviceDate: serviceDate.toISODate() ?? "",
    weekday: serviceDate.weekday,
  };
};

// calculate circular local-hour distance
export const getCircularHourDistance = (
  leftHour: number,
  rightHour: number
): number => {
  const directDistance = Math.abs(leftHour - rightHour);
  return Math.min(directDistance, 24 - directDistance);
};

// match one historical demand bucket
export const isDemandBucketMatch = (
  targetSeconds: number,
  candidateSeconds: number
): boolean => {
  const target = getDemandBucket(targetSeconds);
  const candidate = getDemandBucket(candidateSeconds);
  return (
    target.weekday === candidate.weekday &&
    target.daypart === candidate.daypart &&
    getCircularHourDistance(target.hour, candidate.hour) <= 2
  );
};

// identify one route direction
const getDirectionKey = (direction: DemandShockDirection): string =>
  `${direction.departureId}-${direction.arrivalId}`;

// identify one exact direction bucket
const getDirectionBucketKey = (
  direction: DemandShockDirection,
  bucket: DemandBucket
): string =>
  `${getDirectionKey(direction)}:${bucket.weekday}:${bucket.daypart}:${bucket.hour}`;

// find the first row at or after one epoch
const getTimeStartIndex = (
  rows: DemandShockIndexedCrossing[],
  seconds: number
): number => {
  let low = 0;
  let high = rows.length;
  // narrow the sorted range
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    // advance past earlier rows
    if ((rows[middle]?.adjustedDepartureTime ?? Infinity) < seconds) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

// select one half-open time range
const getRowsInTimeRange = (
  rows: DemandShockIndexedCrossing[],
  start: number,
  end: number
): DemandShockIndexedCrossing[] =>
  rows.slice(getTimeStartIndex(rows, start), getTimeStartIndex(rows, end));

// build reusable prepared direction history
export const createDemandShockHistoryIndex = (
  history: DemandShockCrossing[]
): DemandShockHistoryIndex => {
  const rows = history
    .map((crossing) => {
      const adjustedDepartureTime = getAdjustedDepartureTime(crossing);
      const time = toPacificTime(adjustedDepartureTime);
      return {
        adjustedDepartureTime,
        bucket: getDemandBucket(adjustedDepartureTime),
        crossing,
        month: time.month,
      };
    })
    .sort((left, right) => {
      // preserve adjusted chronological order
      return left.adjustedDepartureTime - right.adjustedDepartureTime;
    });
  const rowsByBucket = new Map<string, DemandShockIndexedCrossing[]>();
  const rowsByDirection = new Map<string, DemandShockIndexedCrossing[]>();
  // index each prepared row once
  rows.forEach((row) => {
    const directionKey = getDirectionKey(row.crossing);
    const bucketKey = getDirectionBucketKey(row.crossing, row.bucket);
    const directionRows = rowsByDirection.get(directionKey);
    // append to an existing direction
    if (directionRows) {
      directionRows.push(row);
    } else {
      rowsByDirection.set(directionKey, [row]);
    }
    const bucketRows = rowsByBucket.get(bucketKey);
    // append to an existing bucket
    if (bucketRows) {
      bucketRows.push(row);
    } else {
      rowsByBucket.set(bucketKey, [row]);
    }
  });
  return { rowsByBucket, rowsByDirection };
};

// detect one reusable history index
const isDemandShockHistoryIndex = (
  history: DemandShockHistorySource
): history is DemandShockHistoryIndex => !Array.isArray(history);

// resolve one prepared history source
const getDemandShockHistoryIndex = (
  history: DemandShockHistorySource
): DemandShockHistoryIndex =>
  isDemandShockHistoryIndex(history)
    ? history
    : createDemandShockHistoryIndex(history);

// select leak-free prepared direction rows
const getEligibleDirectionRows = (
  history: DemandShockHistoryIndex,
  target: DemandShockTarget,
  asOf: number,
  start = Number.NEGATIVE_INFINITY
): DemandShockIndexedCrossing[] => {
  const directionRows =
    history.rowsByDirection.get(getDirectionKey(target)) ?? [];
  const finalizedBefore = asOf - FINALIZATION_LAG_SECONDS;
  return getRowsInTimeRange(directionRows, start, finalizedBefore).filter(
    ({ crossing }) => {
      // exclude the target and invalid outcomes
      return (
        crossing.departureTime !== target.departureTime &&
        !crossing.isCancelled &&
        crossing.totalCapacity > 0
      );
    }
  );
};

// select comparable direction buckets in one time range
const getComparableDemandRows = ({
  anchorBucket,
  end,
  history,
  start,
  target,
}: {
  anchorBucket: DemandBucket;
  end: number;
  history: DemandShockHistoryIndex;
  start: number;
  target: DemandShockTarget;
}): DemandShockIndexedCrossing[] => {
  const rows: DemandShockIndexedCrossing[] = [];
  // collect the five comparable local-hour buckets
  for (let offset = -2; offset <= 2; offset += 1) {
    const hour = (anchorBucket.hour + offset + 24) % 24;
    const key = getDirectionBucketKey(target, {
      ...anchorBucket,
      hour,
    });
    rows.push(
      ...getRowsInTimeRange(history.rowsByBucket.get(key) ?? [], start, end)
    );
  }
  return rows.filter(({ crossing }) => {
    // exclude invalid and target rows
    return (
      crossing.departureTime !== target.departureTime &&
      !crossing.isCancelled &&
      crossing.totalCapacity > 0
    );
  });
};

// calculate circular month distance
const getMonthDistance = (leftMonth: number, rightMonth: number): number => {
  const directDistance = Math.abs(leftMonth - rightMonth);
  return Math.min(directDistance, 12 - directDistance);
};

// map hour distance to cohort weight
const getHourWeight = (distance: number): number => {
  // weight exact-hour matches
  if (distance === 0) {
    return 1;
  }
  // weight adjacent-hour matches
  if (distance === 1) {
    return 0.75;
  }
  return distance === 2 ? 0.5 : 0;
};

// build one sorted leak-free direction history
export const buildDemandShockHistory = (
  history: DemandShockCrossing[],
  target: DemandShockTarget,
  asOf: number
): DemandShockCrossing[] =>
  getEligibleDirectionRows(
    createDemandShockHistoryIndex(history),
    target,
    asOf
  ).map(({ crossing }) => {
    // return the compatible raw view
    return crossing;
  });

// calculate exact base occupied share
const getBaseOccupiedShare = (
  samples: DemandShockBaseSample[],
  targetCapacity: number
): number | null => {
  // project exact estimator samples
  const weightedShares = samples.map((sample) => {
    const available = constrain(
      sample.driveUpCapacity + (sample.reservableCapacity ?? 0),
      0,
      targetCapacity
    );
    return {
      value: (targetCapacity - available) / targetCapacity,
      weight: sample.weight,
    };
  });
  return getWeightedMean(weightedShares);
};

// calculate one established reference cohort
const getReferenceStats = ({
  anchorTime,
  asOf,
  history,
  target,
  targetCapacity,
}: {
  anchorTime: number;
  asOf: number;
  history: DemandShockHistoryIndex;
  target: DemandShockTarget;
  targetCapacity: number;
}): ReferenceStats | null => {
  const asOfTime = toPacificTime(asOf);
  const referenceStart = asOfTime
    .minus({ years: HISTORY_WINDOW_YEARS })
    .toSeconds();
  const recentStart = asOfTime.minus({ days: RECENT_WINDOW_DAYS }).toSeconds();
  const anchorPacific = toPacificTime(anchorTime);
  const anchorBucket = getDemandBucket(anchorTime);
  const weightedShares = getComparableDemandRows({
    anchorBucket,
    end: recentStart,
    history,
    start: referenceStart,
    target,
  })
    .map(({ adjustedDepartureTime, bucket, crossing, month }) => {
      const share = normalizeOccupiedShare(crossing, targetCapacity);
      const hourWeight = getHourWeight(
        getCircularHourDistance(anchorBucket.hour, bucket.hour)
      );
      const recencyWeight = getHalfLifeWeight(
        asOf - adjustedDepartureTime,
        REFERENCE_HALF_LIFE_SECONDS
      );
      const seasonWeight =
        getMonthDistance(anchorPacific.month, month) <= 1 ? 1 : 0.5;
      return share === null
        ? null
        : { value: share, weight: hourWeight * recencyWeight * seasonWeight };
    })
    .filter((sample): sample is WeightedShare => sample !== null);
  const weights = weightedShares.map(({ weight }) => weight);
  const effectiveSampleSize = getEffectiveSampleSize(weights);
  const mean = getWeightedMean(weightedShares);
  // enforce established cohort strength
  if (
    weightedShares.length < MIN_REFERENCE_ROWS ||
    effectiveSampleSize < MIN_REFERENCE_EFFECTIVE_SIZE ||
    mean === null
  ) {
    return null;
  }
  return {
    effectiveSampleSize,
    mean,
    sampleSize: weightedShares.length,
  };
};

// calculate the incremental regime component
export const getIncrementalRegimeSignal = ({
  baseOccupiedShare,
  effectiveSampleSize,
  observedOccupiedShare,
  referenceOccupiedShare,
  sampleSize,
}: {
  baseOccupiedShare: number;
  effectiveSampleSize: number;
  observedOccupiedShare: number;
  referenceOccupiedShare: number;
  sampleSize: number;
}): DemandShockSignal => {
  const rawResidual = observedOccupiedShare - referenceOccupiedShare;
  const shrink =
    effectiveSampleSize / (effectiveSampleSize + REGIME_SHRINK_PRIOR);
  const targetOccupiedShare = constrainShare(
    referenceOccupiedShare + shrink * rawResidual
  );
  const occupiedShareDelta = constrain(
    targetOccupiedShare - baseOccupiedShare,
    -MAX_REGIME_DELTA,
    MAX_REGIME_DELTA
  );
  return {
    baseOccupiedShare,
    effectiveSampleSize,
    occupiedShareDelta,
    observedOccupiedShare,
    rawResidual,
    referenceOccupiedShare,
    sampleSize,
    targetOccupiedShare,
  };
};

// calculate one recent-regime cohort
const getRecentRegimeSignal = ({
  asOf,
  baseSamples,
  history,
  target,
}: Pick<DemandShockInput, "asOf" | "baseSamples" | "target"> & {
  history: DemandShockHistoryIndex;
}): DemandShockSignal | null => {
  const reference = getReferenceStats({
    anchorTime: target.departureTime,
    asOf,
    history,
    target,
    targetCapacity: target.targetCapacity,
  });
  const baseOccupiedShare = getBaseOccupiedShare(
    baseSamples,
    target.targetCapacity
  );
  // require established and exact-base state
  if (!reference || baseOccupiedShare === null) {
    return null;
  }
  const recentStart = toPacificTime(asOf)
    .minus({ days: RECENT_WINDOW_DAYS })
    .toSeconds();
  const targetBucket = getDemandBucket(target.departureTime);
  const weightedShares = getComparableDemandRows({
    anchorBucket: targetBucket,
    end: asOf - FINALIZATION_LAG_SECONDS,
    history,
    start: recentStart,
    target,
  })
    .map(({ adjustedDepartureTime, bucket, crossing }) => {
      const share = normalizeOccupiedShare(crossing, target.targetCapacity);
      const hourWeight = getHourWeight(
        getCircularHourDistance(targetBucket.hour, bucket.hour)
      );
      return share === null
        ? null
        : {
            serviceDate: bucket.serviceDate,
            value: share,
            weight:
              hourWeight *
              getHalfLifeWeight(
                asOf - adjustedDepartureTime,
                RECENT_HALF_LIFE_SECONDS
              ),
          };
    })
    .filter(
      (
        sample
      ): sample is WeightedShare & {
        serviceDate: string;
      } => sample !== null
    );
  const effectiveSampleSize = getEffectiveSampleSize(
    weightedShares.map(({ weight }) => weight)
  );
  const serviceDates = new Set(
    weightedShares.map(({ serviceDate }) => serviceDate)
  );
  const observedOccupiedShare = getWeightedMean(weightedShares);
  // enforce recent cohort strength
  if (
    weightedShares.length < MIN_RECENT_ROWS ||
    effectiveSampleSize < MIN_RECENT_EFFECTIVE_SIZE ||
    serviceDates.size < MIN_RECENT_SERVICE_DATES ||
    observedOccupiedShare === null
  ) {
    return null;
  }
  return getIncrementalRegimeSignal({
    baseOccupiedShare,
    effectiveSampleSize,
    observedOccupiedShare,
    referenceOccupiedShare: reference.mean,
    sampleSize: weightedShares.length,
  });
};

// calculate one same-day component from residual rows
export const getSameDaySignal = ({
  hoursUntilTarget,
  samples,
}: {
  hoursUntilTarget: number;
  samples: SameDaySignalSample[];
}): DemandShockSignal | null => {
  const selected = [...samples]
    .filter((sample) => {
      return (
        Number.isFinite(sample.ageMinutes) &&
        sample.ageMinutes >= 0 &&
        Number.isFinite(sample.observedOccupiedShare) &&
        Number.isFinite(sample.referenceOccupiedShare)
      );
    })
    .sort((left, right) => left.ageMinutes - right.ageMinutes)
    .slice(0, MAX_SAME_DAY_ROWS);
  // require three completed residuals
  if (selected.length < MIN_SAME_DAY_ROWS) {
    return null;
  }
  const weightedResiduals = selected.map((sample) => ({
    value: sample.observedOccupiedShare - sample.referenceOccupiedShare,
    weight: getHalfLifeWeight(
      sample.ageMinutes * 60,
      SAME_DAY_HALF_LIFE_SECONDS
    ),
  }));
  const weights = weightedResiduals.map(({ weight }) => weight);
  const effectiveSampleSize = getEffectiveSampleSize(weights);
  const rawResidual = getWeightedMean(weightedResiduals) ?? 0;
  const observedOccupiedShare =
    getWeightedMean(
      selected.map((sample, index) => ({
        value: sample.observedOccupiedShare,
        weight: weights[index],
      }))
    ) ?? 0;
  const referenceOccupiedShare =
    getWeightedMean(
      selected.map((sample, index) => ({
        value: sample.referenceOccupiedShare,
        weight: weights[index],
      }))
    ) ?? 0;
  const preDecay = constrain(
    rawResidual *
      (effectiveSampleSize / (effectiveSampleSize + SAME_DAY_SHRINK_PRIOR)),
    -MAX_SAME_DAY_DELTA,
    MAX_SAME_DAY_DELTA
  );
  const horizonDecay =
    hoursUntilTarget > 0 && hoursUntilTarget <= SAME_DAY_TARGET_HORIZON_HOURS
      ? 2 ** (-hoursUntilTarget / 2)
      : 0;
  return {
    baseOccupiedShare: null,
    effectiveSampleSize,
    occupiedShareDelta: preDecay * horizonDecay,
    observedOccupiedShare,
    rawResidual,
    referenceOccupiedShare,
    sampleSize: selected.length,
    targetOccupiedShare: null,
  };
};

// calculate one history-backed same-day component
const getHistorySameDaySignal = ({
  asOf,
  history,
  target,
}: Pick<DemandShockInput, "asOf" | "target"> & {
  history: DemandShockHistoryIndex;
}): DemandShockSignal | null => {
  const sameDayRows = getEligibleDirectionRows(
    history,
    target,
    asOf,
    asOf - SAME_DAY_WINDOW_SECONDS
  )
    .sort((left, right) => {
      return right.adjustedDepartureTime - left.adjustedDepartureTime;
    })
    .slice(0, MAX_SAME_DAY_ROWS)
    .map(({ adjustedDepartureTime, crossing }) => {
      const observedOccupiedShare = normalizeOccupiedShare(
        crossing,
        target.targetCapacity
      );
      const reference = getReferenceStats({
        anchorTime: adjustedDepartureTime,
        asOf,
        history,
        target,
        targetCapacity: target.targetCapacity,
      });
      // require observed and reference state
      if (observedOccupiedShare === null || !reference) {
        return null;
      }
      return {
        ageMinutes: (asOf - adjustedDepartureTime) / 60,
        observedOccupiedShare,
        referenceOccupiedShare: reference.mean,
      };
    })
    .filter((sample): sample is SameDaySignalSample => sample !== null);
  return getSameDaySignal({
    hoursUntilTarget: (target.departureTime - asOf) / (60 * 60),
    samples: sameDayRows,
  });
};

// apply the asymmetric warning-loss policy
export const regularizeDemandShockDelta = (
  occupiedShareDelta: number
): number => {
  const boundedDelta = constrain(
    occupiedShareDelta,
    -MAX_COMBINED_DELTA,
    MAX_COMBINED_DELTA
  );
  // preserve overload responsiveness
  if (boundedDelta >= 0) {
    return boundedDelta;
  }
  const magnitude = Math.abs(boundedDelta) / MAX_COMBINED_DELTA;
  return -MAX_COMBINED_DELTA * magnitude * magnitude;
};

// combine bounded demand components
export const combineDemandShockSignals = (
  recentRegime: DemandShockSignal | null,
  sameDay: DemandShockSignal | null
): DemandShockAdjustment => {
  const combined = constrain(
    (recentRegime?.occupiedShareDelta ?? 0) +
      (sameDay?.occupiedShareDelta ?? 0),
    -MAX_COMBINED_DELTA,
    MAX_COMBINED_DELTA
  );
  const regularized = regularizeDemandShockDelta(combined);
  return {
    occupiedShareDelta:
      Math.abs(regularized) < MIN_MATERIAL_DELTA ? 0 : regularized,
    recentRegime,
    sameDay,
  };
};

// calculate the complete bounded demand adjustment
export const getDemandShockAdjustment = (
  input: DemandShockInput
): DemandShockAdjustment => {
  // reject invalid target capacity
  if (input.target.targetCapacity <= 0) {
    return combineDemandShockSignals(null, null);
  }
  const history = getDemandShockHistoryIndex(input.history);
  const recentRegime = getRecentRegimeSignal({ ...input, history });
  return combineDemandShockSignals(
    recentRegime,
    getHistorySameDaySignal({
      asOf: input.asOf,
      history,
      target: input.target,
    })
  );
};

// regularize shifted probability toward its exact baseline
export const regularizeDemandShockProbability = (
  baselineProbability: number,
  shiftedProbability: number,
  occupiedShareDelta: number
): number => {
  const linearWeight = constrain(
    Math.abs(occupiedShareDelta) / MAX_COMBINED_DELTA,
    0,
    1
  );
  // encode asymmetric warning-loss costs
  const weight =
    occupiedShareDelta > 0
      ? linearWeight * (2 - linearWeight)
      : linearWeight * linearWeight;
  const baseline = constrain(baselineProbability, 0, 1);
  const shifted = constrain(shiftedProbability, 0, 1);
  return baseline + weight * (shifted - baseline);
};

// align one material candidate point with strict-full probability
export const alignDemandShockPointEstimate = <
  T extends DemandShockCapacityPair,
>(
  capacity: T,
  fullProbability: number,
  occupiedShareDelta: number,
  targetCapacity: number
): T => {
  // preserve inactive or invalid candidates
  if (
    occupiedShareDelta === 0 ||
    targetCapacity <= 0 ||
    fullProbability >= 0.5
  ) {
    return { ...capacity };
  }
  const availableCapacity = constrain(
    capacity.driveUpCapacity + (capacity.reservableCapacity ?? 0),
    0,
    targetCapacity
  );
  const firstNonStrictCapacity = Math.floor(targetCapacity * 0.02) + 1;
  // preserve already coherent point estimates
  if (availableCapacity >= firstNonStrictCapacity) {
    return { ...capacity };
  }
  return {
    ...capacity,
    driveUpCapacity:
      capacity.driveUpCapacity + (firstNonStrictCapacity - availableCapacity),
  };
};

// shift one capacity pair by occupied-share delta
export const shiftCapacityForDemand = <
  T extends {
    driveUpCapacity: number;
    reservableCapacity: number | null;
  },
>(
  capacity: T,
  occupiedShareDelta: number,
  targetCapacity: number
): T => {
  // preserve invalid targets
  if (targetCapacity <= 0 || occupiedShareDelta === 0) {
    return { ...capacity };
  }
  const boundedDelta = constrain(
    occupiedShareDelta,
    -MAX_COMBINED_DELTA,
    MAX_COMBINED_DELTA
  );
  const availableReservable = capacity.reservableCapacity ?? 0;
  const availableTotal = constrain(
    capacity.driveUpCapacity + availableReservable,
    0,
    targetCapacity
  );
  const occupiedVehicleDelta = Math.round(boundedDelta * targetCapacity);
  // increase demand through drive-up first
  if (occupiedVehicleDelta > 0) {
    const driveUpReduction = Math.min(
      capacity.driveUpCapacity,
      occupiedVehicleDelta
    );
    const reservableReduction = Math.min(
      availableReservable,
      occupiedVehicleDelta - driveUpReduction
    );
    return {
      ...capacity,
      driveUpCapacity: capacity.driveUpCapacity - driveUpReduction,
      reservableCapacity:
        capacity.reservableCapacity === null
          ? null
          : capacity.reservableCapacity - reservableReduction,
    };
  }
  const addedAvailability = Math.min(
    -occupiedVehicleDelta,
    targetCapacity - availableTotal
  );
  return {
    ...capacity,
    driveUpCapacity: capacity.driveUpCapacity + addedAvailability,
  };
};

// shift one exact estimator sample set
export const shiftCapacitySamplesForDemand = <
  T extends {
    driveUpCapacity: number;
    reservableCapacity: number | null;
  },
>(
  samples: T[],
  occupiedShareDelta: number,
  targetCapacity: number
): T[] =>
  samples.map((sample) =>
    shiftCapacityForDemand(sample, occupiedShareDelta, targetCapacity)
  );
