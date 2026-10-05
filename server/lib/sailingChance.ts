import type {
  FillTimingCapacity,
  SailingAssessment,
  TravelMode,
  TravelUncertainty,
} from "shared/contracts/sailingRecommendations";

import type { FillTimingRateDistribution } from "./fillTiming";

export const TRAVEL_QUANTILE_COUNT = 101;
export const MAX_MODELED_BUFFER_MINUTES = 60;
export const SAILING_CHANCE_MODEL_VERSION = "joint-triangular-v1" as const;
export const TRAVEL_UNCERTAINTY_MODEL_VERSION = "triangular-travel-v1" as const;

export interface CreateTravelUncertaintyInput {
  durationSeconds: number;
  mode: TravelMode;
  routeRequestedAt: number;
  staticDurationSeconds?: number | null;
  trafficAware: boolean;
}

export interface EstimateSailingChanceInput {
  arrivalAt: number;
  capacity: FillTimingCapacity | null;
  eligibilityReason: SailingAssessment["eligibilityReason"];
  forecastFullProbability?: number;
  latestArrivalAt: number;
  mode: TravelMode;
  rateDistribution: FillTimingRateDistribution | null;
  travelUncertainty: TravelUncertainty;
}

export interface SailingChanceEstimate {
  chance: SailingAssessment["chance"];
  spacesAtArrivalRange: SailingAssessment["spacesAtArrivalRange"];
}

// normalize trusted provider timing inputs to finite nonnegative seconds
const finiteSeconds = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

// derive the documented assumed travel-time prior
export const createTravelUncertainty = ({
  durationSeconds,
  mode,
  routeRequestedAt,
  staticDurationSeconds,
  trafficAware,
}: CreateTravelUncertaintyInput): TravelUncertainty => {
  const duration = finiteSeconds(durationSeconds);
  const requestedAt = Number.isFinite(routeRequestedAt) ? routeRequestedAt : 0;
  const staticDuration =
    typeof staticDurationSeconds === "number" &&
    Number.isFinite(staticDurationSeconds) &&
    staticDurationSeconds >= 0
      ? staticDurationSeconds
      : duration;
  let widthSeconds = Math.max(
    120,
    0.15 * duration,
    Math.abs(duration - staticDuration)
  );
  // widen driving when google could not retain traffic awareness
  if (mode === "drive" && !trafficAware) {
    widthSeconds = Math.max(widthSeconds, 300, 0.25 * duration);
  }
  return {
    earliestArrivalAt: requestedAt + Math.max(0, duration - widthSeconds),
    latestArrivalAt: requestedAt + duration + widthSeconds,
    modelVersion: TRAVEL_UNCERTAINTY_MODEL_VERSION,
    widthSeconds,
  };
};

// sample one midpoint quantile from a triangular distribution
const triangularQuantile = (
  probability: number,
  minimum: number,
  mostLikely: number,
  maximum: number
): number => {
  // collapse an exact point distribution
  if (minimum === maximum) {
    return minimum;
  }
  const width = maximum - minimum;
  const modeProbability = (mostLikely - minimum) / width;
  // invert the rising side
  if (probability < modeProbability) {
    return minimum + Math.sqrt(probability * width * (mostLikely - minimum));
  }
  return (
    maximum - Math.sqrt((1 - probability) * width * (maximum - mostLikely))
  );
};

// create fixed midpoint quantiles for deterministic integration
const travelSamples = (
  arrivalAt: number,
  uncertainty: TravelUncertainty
): number[] => {
  const minimum = uncertainty.earliestArrivalAt;
  const maximum = uncertainty.latestArrivalAt;
  const mode = Math.min(maximum, Math.max(minimum, arrivalAt));
  return Array.from({ length: TRAVEL_QUANTILE_COUNT }, (_, index) =>
    triangularQuantile(
      (index + 0.5) / TRAVEL_QUANTILE_COUNT,
      minimum,
      mode,
      maximum
    )
  );
};

// evaluate the strict cdf for one triangular depletion-rate prior
const strictTriangularCdf = (
  threshold: number,
  distribution: FillTimingRateDistribution
): number => {
  const { maximum, minimum, mostLikely } = distribution;
  // preserve strict comparison for a point-mass rate
  if (minimum === maximum) {
    return threshold > minimum ? 1 : 0;
  }
  // reject rates at or below the support
  if (threshold <= minimum) {
    return 0;
  }
  // accept every rate above the support
  if (threshold >= maximum) {
    return 1;
  }
  const width = maximum - minimum;
  // integrate the rising density
  if (threshold <= mostLikely && mostLikely > minimum) {
    return (
      ((threshold - minimum) * (threshold - minimum)) /
      (width * (mostLikely - minimum))
    );
  }
  return (
    1 -
    ((maximum - threshold) * (maximum - threshold)) /
      (width * (maximum - mostLikely))
  );
};

// calculate capacity survival for the same sampled arrival
const capacityProbabilityAt = (
  arrivalAt: number,
  distribution: FillTimingRateDistribution
): number => {
  const elapsedMinutes = Math.max(0, arrivalAt - distribution.anchorAt) / 60;
  // retain positive anchor space before any depletion interval
  if (elapsedMinutes === 0) {
    return distribution.spacesAtAnchor > 0 ? 1 : 0;
  }
  return strictTriangularCdf(
    distribution.spacesAtAnchor / elapsedMinutes,
    distribution
  );
};

// return one repeated probability band
const repeated = <Value>(value: Value): Value[] =>
  Array.from({ length: MAX_MODELED_BUFFER_MINUTES + 1 }, () => value);

// calculate the transparent joint timing and capacity prior
export const estimateSailingChance = ({
  arrivalAt,
  capacity,
  eligibilityReason,
  forecastFullProbability,
  latestArrivalAt,
  mode,
  rateDistribution,
  travelUncertainty,
}: EstimateSailingChanceInput): SailingChanceEstimate => {
  const isDrive = mode === "drive";
  const basis = isDrive ? "timing-and-capacity" : "timing-only";
  const samples = travelSamples(arrivalAt, travelUncertainty);
  const timingProbabilities = Array.from(
    { length: MAX_MODELED_BUFFER_MINUTES + 1 },
    (_, bufferMinutes) => {
      const cutoff = latestArrivalAt - bufferMinutes * 60;
      return (
        samples.filter((sampleArrival) => sampleArrival <= cutoff).length /
        samples.length
      );
    }
  );
  // hard-zero structurally ineligible sailings while retaining timing context
  if (eligibilityReason !== null) {
    return {
      chance: {
        basis,
        capacityProbability: null,
        depletionRateRange: null,
        modelVersion: SAILING_CHANCE_MODEL_VERSION,
        probabilities: repeated(0),
        timingProbabilities,
      },
      spacesAtArrivalRange: null,
    };
  }
  // preserve direct observed fullness as a deterministic driver result
  if (isDrive && capacity?.state === "already-full") {
    return {
      chance: {
        basis,
        capacityProbability: 0,
        depletionRateRange: null,
        modelVersion: SAILING_CHANCE_MODEL_VERSION,
        probabilities: repeated(0),
        timingProbabilities,
      },
      spacesAtArrivalRange: { maximum: 0, minimum: 0 },
    };
  }
  // ignore vehicle capacity for non-driving modes
  if (!isDrive) {
    return {
      chance: {
        basis,
        capacityProbability: null,
        depletionRateRange: null,
        modelVersion: SAILING_CHANCE_MODEL_VERSION,
        probabilities: [...timingProbabilities],
        timingProbabilities,
      },
      spacesAtArrivalRange: null,
    };
  }
  // distinguish unknown capacity from deterministic zero capacity
  if (!capacity || capacity.state === "unavailable" || !rateDistribution) {
    // use calibrated forecast risk without fabricating a live anchor or fill rate
    if (
      typeof forecastFullProbability === "number" &&
      Number.isFinite(forecastFullProbability) &&
      forecastFullProbability >= 0 &&
      forecastFullProbability <= 1
    ) {
      const capacityProbability = 1 - forecastFullProbability;
      return {
        chance: {
          basis,
          capacityProbability,
          depletionRateRange: null,
          forecastFullProbability,
          modelVersion: SAILING_CHANCE_MODEL_VERSION,
          probabilities: timingProbabilities.map(
            // no live depletion evidence supports correlating forecast fullness with arrival
            (timing) => timing * capacityProbability
          ),
          timingProbabilities,
        },
        spacesAtArrivalRange: null,
      };
    }
    return {
      chance: {
        basis,
        capacityProbability: null,
        depletionRateRange: null,
        modelVersion: SAILING_CHANCE_MODEL_VERSION,
        probabilities: repeated(null),
        timingProbabilities,
      },
      spacesAtArrivalRange: null,
    };
  }
  const capacityProbabilities = samples.map((sampleArrival) =>
    capacityProbabilityAt(sampleArrival, rateDistribution)
  );
  const capacityProbability =
    capacityProbabilities.reduce((sum, probability) => sum + probability, 0) /
    samples.length;
  const probabilities = timingProbabilities.map(
    (_probability, bufferMinutes) => {
      const cutoff = latestArrivalAt - bufferMinutes * 60;
      return (
        samples.reduce(
          (sum, sampleArrival, index) =>
            sum + (sampleArrival <= cutoff ? capacityProbabilities[index] : 0),
          0
        ) / samples.length
      );
    }
  );
  const earliestElapsedMinutes =
    Math.max(
      0,
      travelUncertainty.earliestArrivalAt - rateDistribution.anchorAt
    ) / 60;
  const latestElapsedMinutes =
    Math.max(0, travelUncertainty.latestArrivalAt - rateDistribution.anchorAt) /
    60;
  const spacesAtArrivalRange = {
    maximum: Math.max(
      0,
      rateDistribution.spacesAtAnchor -
        rateDistribution.minimum * earliestElapsedMinutes
    ),
    minimum: Math.max(
      0,
      rateDistribution.spacesAtAnchor -
        rateDistribution.maximum * latestElapsedMinutes
    ),
  };
  return {
    chance: {
      basis,
      capacityProbability,
      depletionRateRange: {
        maximum: rateDistribution.maximum,
        minimum: rateDistribution.minimum,
        mostLikely: rateDistribution.mostLikely,
      },
      modelVersion: SAILING_CHANCE_MODEL_VERSION,
      probabilities,
      timingProbabilities,
    },
    spacesAtArrivalRange,
  };
};
