import type {
  FillTimingCapacity,
  RecommendedSailing,
  SailingAssessment,
} from "shared/contracts/sailingRecommendations";

export type TimelineSailing = RecommendedSailing & {
  eligibilityReason?: SailingAssessment["eligibilityReason"];
};

export interface SailingCapacityPoint {
  at: number;
  percent: number;
}

export type SailingCapacityModelBasis = "departure-reset" | "live" | "unknown";

export interface SailingCapacitySeries {
  fillRange: { earliest: number | null; latest: number | null } | null;
  from: number;
  fullAt: number | null;
  high: SailingCapacityPoint[];
  key: string;
  low: SailingCapacityPoint[];
  mean: SailingCapacityPoint[];
  modelBasis: SailingCapacityModelBasis;
  sailing: TimelineSailing;
  to: number;
}

type RateBand = "minimum" | "mostLikely" | "maximum";

interface BandModel {
  baselineAt: number;
  baselineSpaces: number;
  rate: number;
}

interface CapacityModel {
  bands: Record<RateBand, BandModel>;
  totalSpaces: number;
}

interface CapacitySource {
  anchorAt: number | null;
  observedSpaces: number | null;
  rates: Record<RateBand, number>;
  totalSpaces: number;
}

const RATE_BANDS: RateBand[] = ["minimum", "mostLikely", "maximum"];

// constrain a timestamp to the chart window
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

// retain a supplied timestamp only when it is numerically usable
const finiteTime = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// identify a sailing consistently across response revisions
const sailingKey = (sailing: TimelineSailing): string =>
  sailing.sailingId || `${sailing.scheduledDepartureAt}:${sailing.vesselName}`;

// validate a live source before allowing it to establish capacity percentages
const capacitySource = (sailing: TimelineSailing): CapacitySource | null => {
  const { capacity } = sailing;
  const projection = capacity?.projection;
  // excluded and departed sources do not quantify current inventory
  if (
    sailing.eligibilityReason === "departed" ||
    !capacity ||
    !projection ||
    capacity.state === "unavailable"
  ) {
    return null;
  }
  const { anchorAt } = capacity;
  const observedSpaces = capacity.observedSpacesAtAnchor;
  const { maximum, minimum, mostLikely } = projection.rate;
  // non-finite or negative projection values cannot define physical depletion
  if (
    !Number.isFinite(projection.totalSpaces) ||
    projection.totalSpaces <= 0 ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(mostLikely) ||
    !Number.isFinite(maximum) ||
    minimum < 0 ||
    mostLikely < minimum ||
    maximum < mostLikely
  ) {
    return null;
  }
  return {
    anchorAt: finiteTime(anchorAt),
    observedSpaces:
      typeof observedSpaces === "number" &&
      Number.isFinite(observedSpaces) &&
      observedSpaces >= 0
        ? observedSpaces
        : null,
    rates: {
      maximum,
      minimum,
      mostLikely,
    },
    totalSpaces: projection.totalSpaces,
  };
};

// establish only the first sailing from its own live inventory observation
const initialModel = (
  source: CapacitySource | null,
  departureAt: number
): CapacityModel | null => {
  // a fresh finite anchor and inventory count are required for the first intercept
  if (
    !source ||
    source.anchorAt === null ||
    source.anchorAt > departureAt ||
    source.observedSpaces === null
  ) {
    return null;
  }
  return {
    bands: {
      minimum: {
        baselineAt: source.anchorAt,
        baselineSpaces: source.observedSpaces,
        rate: source.rates.minimum,
      },
      mostLikely: {
        baselineAt: source.anchorAt,
        baselineSpaces: source.observedSpaces,
        rate: source.rates.mostLikely,
      },
      maximum: {
        baselineAt: source.anchorAt,
        baselineSpaces: source.observedSpaces,
        rate: source.rates.maximum,
      },
    },
    totalSpaces: source.totalSpaces,
  };
};

// calculate unserved demand without capping it to one vessel's denominator
const excessAtDeparture = (
  model: CapacityModel,
  band: RateBand,
  departureAt: number
): number => {
  const source = model.bands[band];
  const elapsedMinutes = Math.max(0, departureAt - source.baselineAt) / 60;
  return Math.max(0, source.rate * elapsedMinutes - source.baselineSpaces);
};

// reset a sailing at the prior departure while retaining its own depletion rate
const rebaseModel = (
  source: CapacitySource,
  predecessor: CapacityModel,
  predecessorDepartureAt: number
): CapacityModel => {
  const bands = {} as Record<RateBand, BandModel>;
  // keep each uncertainty band independent across the sailing boundary
  for (const band of RATE_BANDS) {
    bands[band] = {
      baselineAt: predecessorDepartureAt,
      baselineSpaces:
        source.totalSpaces -
        excessAtDeparture(predecessor, band, predecessorDepartureAt),
      rate: source.rates[band],
    };
  }
  return { bands, totalSpaces: source.totalSpaces };
};

// resolve the modeled saturation corner for one depletion band
const modelFullAt = (model: CapacityModel, band: RateBand): number | null => {
  const source = model.bands[band];
  // an inherited queue that consumes the boat is full at the reset boundary
  if (source.baselineSpaces <= 0) {
    return source.baselineAt;
  }
  // no demand rate leaves positive inventory available indefinitely
  if (source.rate <= 0) {
    return null;
  }
  return source.baselineAt + (source.baselineSpaces / source.rate) * 60;
};

// sample one band with an exact point at any in-segment saturation corner
const sampleBand = (
  model: CapacityModel | null,
  band: RateBand,
  from: number,
  to: number
): SailingCapacityPoint[] => {
  // unknown and zero-width models do not create visible capacity areas
  if (!model || to <= from) {
    return [];
  }
  const source = model.bands[band];
  const timestamps = Array.from(
    { length: 33 },
    (_unused, index) => from + ((to - from) * index) / 32
  );
  const fullAt = modelFullAt(model, band);
  // preserve a sharp full-capacity corner between regular samples
  if (fullAt !== null && fullAt > from && fullAt < to) {
    timestamps.push(fullAt);
  }
  const ordered = [...new Set(timestamps)].sort((a, b) => a - b);
  // evaluate the source model without exposing uncapped backlog as more than 100 percent
  return ordered.map((at) => {
    const elapsedMinutes = Math.max(0, at - source.baselineAt) / 60;
    const remainingSpaces = Math.max(
      0,
      source.baselineSpaces - source.rate * elapsedMinutes
    );
    return {
      at,
      percent: Math.max(
        0,
        Math.min(100, 100 * (1 - remainingSpaces / model.totalSpaces))
      ),
    };
  });
};

// preserve published first-sailing bounds without filling missing endpoints
const publishedFillRange = (
  capacity: FillTimingCapacity | null
): SailingCapacitySeries["fillRange"] => {
  // an absent published interval stays absent
  if (!capacity?.fillRange) {
    return null;
  }
  return {
    earliest: finiteTime(capacity.fillRange.earliest),
    latest: finiteTime(capacity.fillRange.latest),
  };
};

// bound a recomputed full timestamp to its sailing's own departure
const boundedFullAt = (
  model: CapacityModel,
  band: RateBand,
  departureAt: number
): number | null => {
  const fullAt = modelFullAt(model, band);
  return fullAt !== null && fullAt <= departureAt ? fullAt : null;
};

// build independent capacity areas while carrying only modeled excess demand forward
export const buildSailingCapacityTimeline = (
  sailings: TimelineSailing[],
  start: number,
  end: number
): SailingCapacitySeries[] => {
  const windowStart = Number.isFinite(start) ? start : 0;
  const windowEnd = Number.isFinite(end)
    ? Math.max(windowStart, end)
    : windowStart;
  // retain input order for simultaneous departures after chronological sorting
  const ordered = sailings
    .map((sailing, index) => ({ index, sailing }))
    .filter(({ sailing }) => {
      // cancelled, incompatible and invalid departures do not own chart segments
      return (
        sailing.eligibilityReason !== "cancelled" &&
        sailing.eligibilityReason !== "mode-ineligible" &&
        Number.isFinite(sailing.projectedDepartureAt)
      );
    })
    .sort(
      (left, right) =>
        left.sailing.projectedDepartureAt -
          right.sailing.projectedDepartureAt || left.index - right.index
    )
    .map(({ sailing }) => sailing);
  const series: SailingCapacitySeries[] = [];
  let predecessorDepartureAt: number | null = null;
  let predecessorModel: CapacityModel | null = null;
  // derive every sailing from the immediately preceding eligible sailing
  for (const [index, sailing] of ordered.entries()) {
    const departureAt = sailing.projectedDepartureAt;
    const from = clamp(
      predecessorDepartureAt ?? windowStart,
      windowStart,
      windowEnd
    );
    const to = clamp(departureAt, windowStart, windowEnd);
    const source = capacitySource(sailing);
    const ownModel = initialModel(source, departureAt);
    let model = ownModel;
    let modelBasis: SailingCapacityModelBasis = ownModel ? "live" : "unknown";
    // rebase only across a positive interval with quantitative predecessor demand
    if (
      index > 0 &&
      sailing.capacity?.state !== "already-full" &&
      source &&
      predecessorModel &&
      predecessorDepartureAt !== null &&
      departureAt > predecessorDepartureAt
    ) {
      model = rebaseModel(source, predecessorModel, predecessorDepartureAt);
      modelBasis = "departure-reset";
    }
    let fullAt = finiteTime(sailing.capacity?.fillAt);
    let fillRange = publishedFillRange(sailing.capacity);
    // reset models own recomputed exhaustion rather than source timestamps
    if (modelBasis === "departure-reset") {
      fullAt = model ? boundedFullAt(model, "mostLikely", departureAt) : null;
      fillRange = model
        ? {
            earliest: boundedFullAt(model, "maximum", departureAt),
            latest: boundedFullAt(model, "minimum", departureAt),
          }
        : null;
    } else if (index > 0 && modelBasis === "unknown") {
      // later unknown series cannot retain unrelated published timing metadata
      fullAt = null;
      fillRange = null;
    }
    series.push({
      fillRange,
      from,
      fullAt,
      high: sampleBand(model, "maximum", from, to),
      key: sailingKey(sailing),
      low: sampleBand(model, "minimum", from, to),
      mean: sampleBand(model, "mostLikely", from, to),
      modelBasis,
      sailing,
      to,
    });
    predecessorDepartureAt = departureAt;
    // a direct-full observation reveals no backlog to carry into another boat
    predecessorModel =
      sailing.capacity?.state === "already-full" ? null : model;
  }
  return series;
};
