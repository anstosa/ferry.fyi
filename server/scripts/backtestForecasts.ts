import { createHash } from "node:crypto";

import { DateTime } from "luxon";
import { createRequire } from "module";
import { Op } from "sequelize";
import { constrain, round } from "shared/lib/math";

import type {
  HistoricalEstimateInputAudit,
  HolidayDateMap,
} from "../lib/forecast";
import {
  addBinaryForecastSample,
  type BacktestCrossing,
  type BacktestMetricSnapshot,
  type BinaryForecastStats,
  buildComparableHistoryIndex,
  buildShockHistoryIndex,
  createBinaryForecastStats,
  getBacktestAsOf,
  getBacktestComparableCandidates,
  getBacktestComparisonFailures,
  getBacktestEstimatorInputDigest,
  getBacktestPairKey,
  hasForecastCoherenceViolation,
  isPracticalFullEvent,
  isStrictFullEvent,
  parseBacktestLeadMinutes,
  toBinaryForecastReport,
} from "../lib/forecastBacktest";
import {
  type ForecastDaypart,
  getForecastDaypart,
} from "../lib/forecastDaypart";
import { createDemandShockHistoryIndex } from "../lib/forecastDemandShock";
import { FORECAST_REGRESSION_THRESHOLDS } from "../lib/forecastRegressionThresholds";

const DEFAULT_YEAR = 2025;
const HISTORY_YEARS = 2;
const LOW_MISS_THRESHOLD = 20;
const HIGH_MISS_THRESHOLD = 50;
const DEFAULT_MAX_CANDIDATES = 5;
const runtimeRequire = createRequire(__filename);
const CROSSING_ATTRIBUTES = [
  "id",
  "arrivalId",
  "departureDelta",
  "departureId",
  "departureTime",
  "driveUpCapacity",
  "hasReservations",
  "isCancelled",
  "reservableCapacity",
  "totalCapacity",
];

interface BacktestOptions {
  compareDemandShock: boolean;
  from: DateTime;
  assertThresholds: boolean;
  json: boolean;
  limit: number | null;
  leadMinutes: number;
  maxCandidates: number;
  persistCalibration: boolean;
  pair: string | null;
  useCalibration: boolean;
  to: DateTime;
}

interface RouteStats {
  actualFull: number;
  baseOccupiedShareCount: number;
  baseOccupiedShareTotal: number;
  cappedSignals: number;
  coherenceViolations: number;
  count: number;
  forecastFull: number;
  highMisses: number;
  highFull: number;
  likelyFull: number;
  lowMisses: number;
  practicalFull: BinaryForecastStats;
  positiveSignals: number;
  regimeApplied: number;
  negativeSignals: number;
  sameDayApplied: number;
  signalTargets: number;
  strictFull: BinaryForecastStats;
  unlikelyFull: number;
  p90Errors: number[];
  routeClassCounts: Record<string, number>;
  skipped: number;
  totalAbsoluteError: number;
}

interface BacktestSummary {
  adjustmentMode: string;
  comparison?: BacktestComparison;
  dayparts: RouteReport[];
  from: string;
  overall: RouteReport;
  routes: RouteReport[];
  to: string;
}

interface BacktestReportSet {
  dayparts: RouteReport[];
  overall: RouteReport;
  routes: RouteReport[];
}

interface BacktestComparison {
  baseline: BacktestReportSet;
  candidate: BacktestReportSet;
  failures: string[];
  invariants: {
    asOfMatch: boolean;
    baseComparableDigest: string;
    baseComparableDigestMatch: boolean;
    targetCapacityMatch: boolean;
    targetCountMatch: boolean;
  };
}

interface RouteReport {
  actualFull: number;
  cappedSignals: number;
  coherenceViolationRate: number;
  count: number;
  daypart: ForecastDaypart;
  fullBias: number;
  forecastFull: number;
  highMisses: number;
  highMissRate: number;
  highFull: number;
  likelyFull: number;
  lowMisses: number;
  lowMissRate: number;
  mae: number;
  meanBaseOccupiedShare: number;
  unlikelyFull: number;
  p90: number;
  pair: string;
  practicalFull: ReturnType<typeof toBinaryForecastReport>;
  positiveSignals: number;
  regimeApplied: number;
  routeClass: string;
  negativeSignals: number;
  skipped: number;
  sameDayApplied: number;
  signalTargets: number;
  strictFull: ReturnType<typeof toBinaryForecastReport>;
  year: number;
}

// argument lookup
const getArgValue = (args: string[], name: string): string | null => {
  const index = args.indexOf(name);
  // missing argument guard
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
};

// date argument parsing
const parseDate = (value: string, fallback: DateTime): DateTime => {
  const parsed = DateTime.fromISO(value, { zone: "America/Los_Angeles" });
  // invalid date guard
  if (!parsed.isValid) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.startOf("day") ?? fallback;
};

// option parsing
const parseOptions = (): BacktestOptions => {
  const args = process.argv.slice(2);
  const year = Number(getArgValue(args, "--year") ?? DEFAULT_YEAR);
  const defaultFrom = DateTime.fromObject(
    { day: 1, month: 1, year },
    { zone: "America/Los_Angeles" }
  );
  const defaultTo = defaultFrom.plus({ years: 1 });
  return {
    assertThresholds: args.includes("--assert"),
    compareDemandShock: args.includes("--compare-demand-shock"),
    from: getArgValue(args, "--from")
      ? parseDate(getArgValue(args, "--from") ?? "", defaultFrom)
      : defaultFrom,
    json: args.includes("--json"),
    leadMinutes: parseBacktestLeadMinutes(getArgValue(args, "--lead-minutes")),
    limit: getArgValue(args, "--limit")
      ? Number(getArgValue(args, "--limit"))
      : null,
    maxCandidates: getArgValue(args, "--max-candidates")
      ? Number(getArgValue(args, "--max-candidates"))
      : DEFAULT_MAX_CANDIDATES,
    pair: getArgValue(args, "--pair"),
    persistCalibration: args.includes("--persist-calibration"),
    to: getArgValue(args, "--to")
      ? parseDate(getArgValue(args, "--to") ?? "", defaultTo).plus({ days: 1 })
      : defaultTo,
    useCalibration: args.includes("--use-calibration"),
  };
};

// help output
const printHelp = (): void => {
  console.log(
    `Usage: yarn forecast:backtest [--year 2025] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--pair departure-arrival] [--lead-minutes N] [--compare-demand-shock] [--limit N] [--max-candidates N] [--json] [--assert] [--persist-calibration] [--use-calibration]\n\nRuns a leak-free historical/calendar forecast estimator against confirmed DB crossings. --compare-demand-shock evaluates the bounded candidate from identical base samples plus full direction history. Weather and tide presentation are intentionally outside this mode.`
  );
};

// available capacity
const getAvailableCapacity = (crossing: BacktestCrossing): number =>
  crossing.driveUpCapacity + (crossing.reservableCapacity ?? 0);

// route stats factory
const createRouteStats = (): RouteStats => ({
  actualFull: 0,
  baseOccupiedShareCount: 0,
  baseOccupiedShareTotal: 0,
  cappedSignals: 0,
  coherenceViolations: 0,
  count: 0,
  forecastFull: 0,
  highMisses: 0,
  highFull: 0,
  likelyFull: 0,
  lowMisses: 0,
  practicalFull: createBinaryForecastStats(),
  positiveSignals: 0,
  regimeApplied: 0,
  negativeSignals: 0,
  sameDayApplied: 0,
  signalTargets: 0,
  strictFull: createBinaryForecastStats(),
  unlikelyFull: 0,
  p90Errors: [],
  routeClassCounts: {},
  skipped: 0,
  totalAbsoluteError: 0,
});

// stats accumulation
const addSample = (
  stats: RouteStats,
  actualAvailable: number,
  forecastAvailable: number,
  totalCapacity: number,
  fullProbability: number,
  fullRisk: string,
  routeClass: string,
  adjustment?: {
    occupiedShareDelta: number;
    recentRegime: {
      baseOccupiedShare: number | null;
      occupiedShareDelta: number;
    } | null;
    sameDay: { occupiedShareDelta: number } | null;
  }
): void => {
  const absoluteError = Math.abs(forecastAvailable - actualAvailable);
  stats.count += 1;
  stats.totalAbsoluteError += absoluteError;
  stats.p90Errors.push(absoluteError);
  stats.routeClassCounts[routeClass] =
    (stats.routeClassCounts[routeClass] ?? 0) + 1;
  addBinaryForecastSample(
    stats.strictFull,
    isStrictFullEvent(actualAvailable, totalCapacity),
    fullProbability
  );
  addBinaryForecastSample(
    stats.practicalFull,
    isPracticalFullEvent(actualAvailable, totalCapacity),
    fullProbability
  );
  // record coherence violations
  if (
    hasForecastCoherenceViolation(
      forecastAvailable,
      totalCapacity,
      fullProbability
    )
  ) {
    stats.coherenceViolations += 1;
  }
  // record applied demand targets
  if (adjustment && adjustment.occupiedShareDelta !== 0) {
    stats.signalTargets += 1;
    // record positive demand shocks
    if (adjustment.occupiedShareDelta > 0) {
      stats.positiveSignals += 1;
    } else {
      stats.negativeSignals += 1;
    }
  }
  const baseOccupiedShare = adjustment?.recentRegime?.baseOccupiedShare;
  // record aggregate exact-base state
  if (baseOccupiedShare !== null && baseOccupiedShare !== undefined) {
    stats.baseOccupiedShareCount += 1;
    stats.baseOccupiedShareTotal += baseOccupiedShare;
  }
  // record regime components
  if (
    adjustment?.recentRegime &&
    Math.abs(adjustment.recentRegime.occupiedShareDelta) >= 0.01
  ) {
    stats.regimeApplied += 1;
  }
  // record same-day components
  if (
    adjustment?.sameDay &&
    Math.abs(adjustment.sameDay.occupiedShareDelta) >= 0.01
  ) {
    stats.sameDayApplied += 1;
  }
  const componentTotal =
    (adjustment?.recentRegime?.occupiedShareDelta ?? 0) +
    (adjustment?.sameDay?.occupiedShareDelta ?? 0);
  // record combined component caps
  if (adjustment && Math.abs(componentTotal) > 0.25 + Number.EPSILON) {
    stats.cappedSignals += 1;
  }
  // actual full guard
  if (isStrictFullEvent(actualAvailable, totalCapacity)) {
    stats.actualFull += 1;
  }
  // forecast full guard
  if (isStrictFullEvent(forecastAvailable, totalCapacity)) {
    stats.forecastFull += 1;
  }
  // low forecast miss guard
  if (
    actualAvailable <= LOW_MISS_THRESHOLD &&
    forecastAvailable > LOW_MISS_THRESHOLD
  ) {
    stats.lowMisses += 1;
  }
  // high forecast miss guard
  if (
    actualAvailable <= HIGH_MISS_THRESHOLD &&
    forecastAvailable > HIGH_MISS_THRESHOLD
  ) {
    stats.highMisses += 1;
  }
  // unlikely full guard
  if (fullRisk === "unlikely") {
    stats.unlikelyFull += 1;
  }
  // likely full guard
  if (fullRisk === "likely") {
    stats.likelyFull += 1;
  }
  // high full guard
  if (fullRisk === "high") {
    stats.highFull += 1;
  }
};

// p90 calculation
const getP90 = (errors: number[]): number => {
  const sortedErrors = [...errors].sort((left, right) => left - right);
  const index = Math.floor(sortedErrors.length * 0.9);
  return sortedErrors[index] ?? 0;
};

// dominant class
const getDominantRouteClass = (stats: RouteStats): string => {
  let selectedClass = "standard";
  let selectedCount = 0;
  // route class scan
  Object.entries(stats.routeClassCounts).forEach(([routeClass, count]) => {
    // larger class guard
    if (count > selectedCount) {
      selectedClass = routeClass;
      selectedCount = count;
    }
  });
  return selectedClass;
};

// report serialization
const toRouteReport = (
  pair: string,
  stats: RouteStats,
  year: number,
  daypart: ForecastDaypart = "all"
): RouteReport => {
  const lowMissRate = stats.count ? stats.lowMisses / stats.count : 0;
  const highMissRate = stats.count ? stats.highMisses / stats.count : 0;
  const forecastFullRate = stats.count ? stats.forecastFull / stats.count : 0;
  const fullBias = constrain(
    round(
      1 + highMissRate * 1.8 + lowMissRate * 0.8 - forecastFullRate * 0.25,
      2
    ),
    0.85,
    1.45
  );
  return {
    actualFull: stats.actualFull,
    cappedSignals: stats.cappedSignals,
    coherenceViolationRate: stats.count
      ? round(stats.coherenceViolations / stats.count, 4)
      : 0,
    count: stats.count,
    daypart,
    forecastFull: stats.forecastFull,
    fullBias,
    highMisses: stats.highMisses,
    highMissRate: round(highMissRate, 3),
    highFull: stats.highFull,
    likelyFull: stats.likelyFull,
    lowMisses: stats.lowMisses,
    lowMissRate: round(lowMissRate, 3),
    mae: stats.count ? round(stats.totalAbsoluteError / stats.count, 1) : 0,
    meanBaseOccupiedShare: stats.baseOccupiedShareCount
      ? round(stats.baseOccupiedShareTotal / stats.baseOccupiedShareCount, 3)
      : 0,
    unlikelyFull: stats.unlikelyFull,
    p90: round(getP90(stats.p90Errors), 1),
    pair,
    practicalFull: toBinaryForecastReport(stats.practicalFull),
    positiveSignals: stats.positiveSignals,
    regimeApplied: stats.regimeApplied,
    routeClass: getDominantRouteClass(stats),
    negativeSignals: stats.negativeSignals,
    skipped: stats.skipped,
    sameDayApplied: stats.sameDayApplied,
    signalTargets: stats.signalTargets,
    strictFull: toBinaryForecastReport(stats.strictFull),
    year,
  };
};

// merge one binary metric accumulator
const mergeBinaryForecastStats = (
  target: BinaryForecastStats,
  source: BinaryForecastStats
): void => {
  target.actualNegative += source.actualNegative;
  target.actualPositive += source.actualPositive;
  target.brierTotal += source.brierTotal;
  target.count += source.count;
  target.falsePositive += source.falsePositive;
  target.predictedPositive += source.predictedPositive;
  target.truePositive += source.truePositive;
};

// merge one route accumulator
const mergeRouteStats = (target: RouteStats, source: RouteStats): void => {
  target.actualFull += source.actualFull;
  target.baseOccupiedShareCount += source.baseOccupiedShareCount;
  target.baseOccupiedShareTotal += source.baseOccupiedShareTotal;
  target.cappedSignals += source.cappedSignals;
  target.coherenceViolations += source.coherenceViolations;
  target.count += source.count;
  target.forecastFull += source.forecastFull;
  target.highMisses += source.highMisses;
  target.highFull += source.highFull;
  target.likelyFull += source.likelyFull;
  target.lowMisses += source.lowMisses;
  target.negativeSignals += source.negativeSignals;
  target.positiveSignals += source.positiveSignals;
  target.regimeApplied += source.regimeApplied;
  target.sameDayApplied += source.sameDayApplied;
  target.signalTargets += source.signalTargets;
  target.unlikelyFull += source.unlikelyFull;
  target.p90Errors.push(...source.p90Errors);
  mergeBinaryForecastStats(target.practicalFull, source.practicalFull);
  mergeBinaryForecastStats(target.strictFull, source.strictFull);
  // merge route classes
  Object.entries(source.routeClassCounts).forEach(([routeClass, count]) => {
    target.routeClassCounts[routeClass] =
      (target.routeClassCounts[routeClass] ?? 0) + count;
  });
  target.skipped += source.skipped;
  target.totalAbsoluteError += source.totalAbsoluteError;
};

// serialize one backtest accumulator set
const createBacktestReportSet = (
  routeStats: Map<string, RouteStats>,
  daypartStats: Map<string, RouteStats>,
  year: number
): BacktestReportSet => {
  const overallStats = createRouteStats();
  // merge every direction
  routeStats.forEach((stats) => {
    mergeRouteStats(overallStats, stats);
  });
  return {
    dayparts: Array.from(daypartStats.entries())
      .map(([key, stats]) => {
        // split one direction/daypart key
        const [pair, daypart] = key.split("::");
        return toRouteReport(pair, stats, year, daypart as ForecastDaypart);
      })
      .sort((left, right) => right.count - left.count),
    overall: toRouteReport("overall", overallStats, year),
    routes: Array.from(routeStats.entries())
      .map(([pair, stats]) => {
        // serialize one direction
        return toRouteReport(pair, stats, year);
      })
      .sort((left, right) => right.count - left.count),
  };
};

// project report fields into comparison gates
const toMetricSnapshot = (report: RouteReport): BacktestMetricSnapshot => ({
  coherenceViolationRate: report.coherenceViolationRate,
  highMissRate: report.highMissRate,
  lowMissRate: report.lowMissRate,
  mae: report.mae,
  p90: report.p90,
  practicalFull: report.practicalFull,
  strictFull: report.strictFull,
});

// holiday map loading
const loadHolidayMap = async (
  from: DateTime,
  to: DateTime,
  getHolidayDates: (year: number) => Promise<Set<string>>
): Promise<HolidayDateMap> => {
  const years = new Set<number>();
  let cursor = from.minus({ years: HISTORY_YEARS });
  // year range collection
  while (cursor <= to) {
    years.add(cursor.year);
    cursor = cursor.plus({ years: 1 });
  }
  const entries = await Promise.all(
    Array.from(years).map(
      async (year): Promise<[number, Set<string>]> => [
        year,
        await getHolidayDates(year),
      ]
    )
  );
  return Object.fromEntries(entries) as HolidayDateMap;
};

// summary rendering
const printSummary = (summary: BacktestSummary): void => {
  console.log(`Forecast backtest ${summary.from} through ${summary.to}`);
  console.log(
    "pair,daypart,count,mae,p90,actualFull,forecastFull,unlikelyFull,likelyFull,highFull,lowMisses,highMisses,lowMissRate,highMissRate,fullBias,routeClass,skipped"
  );
  // route output
  summary.routes.forEach((route) => {
    console.log(
      [
        route.pair,
        route.daypart,
        route.count,
        route.mae,
        route.p90,
        route.actualFull,
        route.forecastFull,
        route.unlikelyFull,
        route.likelyFull,
        route.highFull,
        route.lowMisses,
        route.highMisses,
        route.lowMissRate,
        route.highMissRate,
        route.fullBias,
        route.routeClass,
        route.skipped,
      ].join(",")
    );
  });
  // daypart output
  summary.dayparts.forEach((route) => {
    console.log(
      [
        route.pair,
        route.daypart,
        route.count,
        route.mae,
        route.p90,
        route.actualFull,
        route.forecastFull,
        route.unlikelyFull,
        route.likelyFull,
        route.highFull,
        route.lowMisses,
        route.highMisses,
        route.lowMissRate,
        route.highMissRate,
        route.fullBias,
        route.routeClass,
        route.skipped,
      ].join(",")
    );
  });
  console.log(
    `baseline,count=${summary.overall.count},mae=${summary.overall.mae},p90=${summary.overall.p90},strictBrier=${summary.overall.strictFull.brier},strictRecall=${summary.overall.strictFull.recall},strictPrecision=${summary.overall.strictFull.precision},strictFalseFullRate=${summary.overall.strictFull.falseFullRate},practicalBrier=${summary.overall.practicalFull.brier},practicalRecall=${summary.overall.practicalFull.recall},practicalPrecision=${summary.overall.practicalFull.precision},practicalFalseFullRate=${summary.overall.practicalFull.falseFullRate},coherenceViolationRate=${summary.overall.coherenceViolationRate},lowMissRate=${summary.overall.lowMissRate},highMissRate=${summary.overall.highMissRate},skipped=${summary.overall.skipped}`
  );
  // paired candidate output
  if (summary.comparison) {
    const { candidate, failures, invariants } = summary.comparison;
    console.log(
      `candidate,count=${candidate.overall.count},mae=${candidate.overall.mae},p90=${candidate.overall.p90},strictBrier=${candidate.overall.strictFull.brier},strictRecall=${candidate.overall.strictFull.recall},strictPrecision=${candidate.overall.strictFull.precision},strictFalseFullRate=${candidate.overall.strictFull.falseFullRate},practicalBrier=${candidate.overall.practicalFull.brier},practicalRecall=${candidate.overall.practicalFull.recall},practicalPrecision=${candidate.overall.practicalFull.precision},practicalFalseFullRate=${candidate.overall.practicalFull.falseFullRate},coherenceViolationRate=${candidate.overall.coherenceViolationRate},lowMissRate=${candidate.overall.lowMissRate},highMissRate=${candidate.overall.highMissRate},signalTargets=${candidate.overall.signalTargets},positiveSignals=${candidate.overall.positiveSignals},negativeSignals=${candidate.overall.negativeSignals},cappedSignals=${candidate.overall.cappedSignals}`
    );
    console.log(
      `paired,invariants=${JSON.stringify(invariants)},failures=${JSON.stringify(failures)}`
    );
  }
};

// absolute threshold assertion
const assertThresholds = (report: RouteReport): void => {
  const failures = [
    report.mae > FORECAST_REGRESSION_THRESHOLDS.mae
      ? `mae ${report.mae} > ${FORECAST_REGRESSION_THRESHOLDS.mae}`
      : null,
    report.p90 > FORECAST_REGRESSION_THRESHOLDS.p90
      ? `p90 ${report.p90} > ${FORECAST_REGRESSION_THRESHOLDS.p90}`
      : null,
    report.lowMissRate > FORECAST_REGRESSION_THRESHOLDS.lowMissRate
      ? `lowMissRate ${report.lowMissRate} > ${FORECAST_REGRESSION_THRESHOLDS.lowMissRate}`
      : null,
    report.highMissRate > FORECAST_REGRESSION_THRESHOLDS.highMissRate
      ? `highMissRate ${report.highMissRate} > ${FORECAST_REGRESSION_THRESHOLDS.highMissRate}`
      : null,
  ].filter((failure): failure is string => Boolean(failure));
  // failure guard
  if (failures.length > 0) {
    throw new Error(
      `Forecast regression thresholds failed: ${failures.join("; ")}`
    );
  }
};

// paired threshold assertion
const getPairedFailures = (
  options: BacktestOptions,
  baseline: RouteReport,
  candidate: RouteReport,
  invariants: BacktestComparison["invariants"]
): string[] => {
  const isClintonSlice =
    options.pair === "5-14" &&
    options.from.toISODate() === "2026-08-17" &&
    options.to.minus({ days: 1 }).toISODate() === "2026-08-31";
  const failures = getBacktestComparisonFailures(
    toMetricSnapshot(baseline),
    toMetricSnapshot(candidate),
    { requireNoWorseMissRates: isClintonSlice }
  );
  // require paired snapshot invariants
  Object.entries(invariants).forEach(([name, value]) => {
    // ignore the evidence digest itself
    if (name === "baseComparableDigest") {
      return;
    }
    // record an invariant failure
    if (value !== true) {
      failures.push(`${name} is not true`);
    }
  });
  // enforce the directional activation gate
  if (isClintonSlice && candidate.signalTargets === 0) {
    failures.push("Clinton slice did not activate a demand signal");
  }
  // enforce no-worse directional recall
  if (
    isClintonSlice &&
    candidate.strictFull.recall < baseline.strictFull.recall
  ) {
    failures.push("Clinton strict recall is worse");
  }
  // enforce no-worse practical recall
  if (
    isClintonSlice &&
    candidate.practicalFull.recall < baseline.practicalFull.recall
  ) {
    failures.push("Clinton practical recall is worse");
  }
  // require material improvement when evidence is sufficient
  if (
    isClintonSlice &&
    baseline.practicalFull.recall < 0.95 &&
    candidate.signalTargets >= 5 &&
    candidate.practicalFull.recall < baseline.practicalFull.recall + 0.02
  ) {
    failures.push("Clinton practical recall improvement is below 0.02");
  }
  return failures;
};

// calibration persistence
const persistCalibration = async (
  reports: RouteReport[],
  ForecastCalibration: typeof import("../models/ForecastCalibration").ForecastCalibration
): Promise<void> => {
  const calculatedAt = Math.floor(Date.now() / 1000);
  // route report loop
  for (const report of reports) {
    const [departureId, arrivalId] = report.pair.split("-");
    // malformed pair guard
    if (!departureId || !arrivalId || report.count === 0) {
      continue;
    }
    const payload = {
      arrivalId,
      calculatedAt,
      daypart: report.daypart,
      departureId,
      fullBias: report.fullBias,
      highMissRate: report.highMissRate,
      lowMissRate: report.lowMissRate,
      mae: report.mae,
      p90: report.p90,
      routeClass: report.routeClass,
      sampleSize: report.count,
      year: report.year,
    };
    const existingCalibration = await ForecastCalibration.findOne({
      where: {
        arrivalId,
        daypart: report.daypart,
        departureId,
        year: report.year,
      },
    });
    // existing calibration guard
    if (existingCalibration) {
      await existingCalibration.update(payload);
    } else {
      await ForecastCalibration.create(payload);
    }
  }
};

// backtest runner
const run = async (): Promise<void> => {
  // help guard
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const { dbInit } = runtimeRequire("../lib/db") as typeof import("../lib/db");
  const { getHistoricalEstimate, reconcileForecastCoherence } = runtimeRequire(
    "../lib/forecast"
  ) as typeof import("../lib/forecast");
  const holidayModule = runtimeRequire(
    "../lib/holidays"
  ) as typeof import("../lib/holidays");
  const crossingModule = runtimeRequire(
    "../models/Crossing"
  ) as typeof import("../models/Crossing");
  const demandEventModule = runtimeRequire(
    "../models/DemandEvent"
  ) as typeof import("../models/DemandEvent");
  const forecastCalibrationModule = runtimeRequire(
    "../models/ForecastCalibration"
  ) as typeof import("../models/ForecastCalibration");
  const terminalModule = runtimeRequire(
    "../models/Terminal"
  ) as typeof import("../models/Terminal");
  const Crossing = crossingModule.default;
  const { DemandEvent } = demandEventModule;
  const { ForecastCalibration } = forecastCalibrationModule;
  const { Terminal } = terminalModule;
  const options = parseOptions();
  const { year } = options.from;
  await dbInit;
  const where = {
    departureTime: {
      [Op.gte]: options.from.toSeconds(),
      [Op.lt]: options.to.toSeconds(),
    },
    isCancelled: false,
    totalCapacity: { [Op.gt]: 0 },
    ...(options.pair
      ? {
          arrivalId: options.pair.split("-")[1],
          departureId: options.pair.split("-")[0],
        }
      : {}),
  };
  const historyWhere = {
    departureTime: {
      [Op.gte]: options.from.minus({ years: HISTORY_YEARS }).toSeconds(),
      [Op.lt]: options.to.toSeconds(),
    },
    isCancelled: false,
    totalCapacity: { [Op.gt]: 0 },
  };
  const [targets, history, holidays, demandEvents, persistedCalibrations] =
    await Promise.all([
      Crossing.findAll({
        attributes: CROSSING_ATTRIBUTES,
        limit: options.limit ?? undefined,
        order: [["departureTime", "ASC"]],
        raw: true,
        where,
      }),
      Crossing.findAll({
        attributes: CROSSING_ATTRIBUTES,
        order: [["departureTime", "ASC"]],
        raw: true,
        where: historyWhere,
      }),
      loadHolidayMap(
        options.from,
        options.to,
        holidayModule.getWashingtonHolidayDates
      ),
      DemandEvent.findAll({
        raw: true,
        where: {
          startsAt: {
            [Op.gte]: options.from.minus({ years: HISTORY_YEARS }).toSeconds(),
            [Op.lte]: options.to.plus({ days: 1 }).toSeconds(),
          },
        },
      }),
      options.useCalibration
        ? ForecastCalibration.findAll({
            raw: true,
            where: { year: { [Op.lte]: options.from.year } },
          })
        : Promise.resolve([]),
    ]);
  const typedHistory = history as BacktestCrossing[];
  const historyIndex = buildComparableHistoryIndex(typedHistory);
  const shockHistoryIndex = options.compareDemandShock
    ? buildShockHistoryIndex(typedHistory)
    : null;
  const demandShockHistoryByPair = new Map(
    Array.from(shockHistoryIndex?.entries() ?? []).map(([pair, rows]) => {
      // prepare each direction once
      return [pair, createDemandShockHistoryIndex(rows)] as const;
    })
  );
  const calibrationByPair = new Map(
    persistedCalibrations.map((calibration) => {
      return [
        `${calibration.departureId}-${calibration.arrivalId}::${calibration.daypart}`,
        calibration,
      ];
    })
  );
  const routeStats = new Map<string, RouteStats>();
  const daypartStats = new Map<string, RouteStats>();
  const candidateRouteStats = new Map<string, RouteStats>();
  const candidateDaypartStats = new Map<string, RouteStats>();
  const baselineSnapshotHash = createHash("sha256");
  const candidateSnapshotHash = createHash("sha256");
  const baselineAsOfHash = createHash("sha256");
  const candidateAsOfHash = createHash("sha256");
  const baselineCapacityHash = createHash("sha256");
  const candidateCapacityHash = createHash("sha256");
  // target sweep
  for (const target of targets as BacktestCrossing[]) {
    const pair = getBacktestPairKey(target);
    const targetTime = DateTime.fromSeconds(target.departureTime, {
      zone: "America/Los_Angeles",
    });
    const asOf = getBacktestAsOf(target.departureTime, options.leadMinutes);
    const daypart = getForecastDaypart(targetTime);
    const daypartKey = `${pair}::${daypart}`;
    const stats = routeStats.get(pair) ?? createRouteStats();
    const daypartRouteStats =
      daypartStats.get(daypartKey) ?? createRouteStats();
    routeStats.set(pair, stats);
    daypartStats.set(daypartKey, daypartRouteStats);
    const candidateStats = candidateRouteStats.get(pair) ?? createRouteStats();
    const candidateDaypartRouteStats =
      candidateDaypartStats.get(daypartKey) ?? createRouteStats();
    candidateRouteStats.set(pair, candidateStats);
    candidateDaypartStats.set(daypartKey, candidateDaypartRouteStats);
    const terminal = Terminal.getByIndex(target.departureId);
    const pairHistory = getBacktestComparableCandidates(
      target,
      historyIndex,
      options.maxCandidates,
      asOf.toSeconds()
    ) as Parameters<typeof getHistoricalEstimate>[1];
    const routeContext = {
      arrivalId: target.arrivalId,
      calibration:
        calibrationByPair.get(daypartKey) ??
        calibrationByPair.get(`${pair}::all`),
      departureId: target.departureId,
      events: demandEvents,
    };
    // record one actual baseline invocation
    const auditBaselineInput = (audit: HistoricalEstimateInputAudit): void => {
      baselineSnapshotHash.update(
        `${getBacktestEstimatorInputDigest({
          ...audit,
          targetId: target.id ?? `${pair}-${target.departureTime}`,
        })}|`
      );
      baselineAsOfHash.update(`${audit.asOf}|`);
      baselineCapacityHash.update(`${audit.targetCapacity}|`);
    };
    const estimate = getHistoricalEstimate(
      targetTime,
      pairHistory,
      terminal,
      asOf,
      holidays,
      target.totalCapacity,
      { ...routeContext, onInputAudit: auditBaselineInput }
    );
    // missing estimate guard
    if (!estimate) {
      stats.skipped += 1;
      daypartRouteStats.skipped += 1;
      // preserve paired skip counts
      if (options.compareDemandShock) {
        candidateStats.skipped += 1;
        candidateDaypartRouteStats.skipped += 1;
      }
      continue;
    }
    addSample(
      stats,
      getAvailableCapacity(target),
      estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0),
      target.totalCapacity,
      estimate.fullProbability,
      estimate.fullRisk,
      estimate.routeClass
    );
    addSample(
      daypartRouteStats,
      getAvailableCapacity(target),
      estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0),
      target.totalCapacity,
      estimate.fullProbability,
      estimate.fullRisk,
      estimate.routeClass
    );
    // skip candidate work unless requested
    if (!options.compareDemandShock || !shockHistoryIndex) {
      continue;
    }
    const fullDirectionHistory = demandShockHistoryByPair.get(pair);
    // require one prepared direction history
    if (!fullDirectionHistory) {
      candidateStats.skipped += 1;
      candidateDaypartRouteStats.skipped += 1;
      continue;
    }
    // record one actual candidate invocation
    const auditCandidateInput = (audit: HistoricalEstimateInputAudit): void => {
      candidateSnapshotHash.update(
        `${getBacktestEstimatorInputDigest({
          ...audit,
          targetId: target.id ?? `${pair}-${target.departureTime}`,
        })}|`
      );
      candidateAsOfHash.update(`${audit.asOf}|`);
      candidateCapacityHash.update(`${audit.targetCapacity}|`);
    };
    const candidateEstimate = getHistoricalEstimate(
      targetTime,
      pairHistory,
      terminal,
      asOf,
      holidays,
      target.totalCapacity,
      {
        ...routeContext,
        demandShock: {
          asOf: asOf.toSeconds(),
          baselineFullProbability: estimate.fullProbability,
          history: fullDirectionHistory,
        },
        onInputAudit: auditCandidateInput,
      }
    );
    // keep paired skips aligned
    if (!candidateEstimate) {
      candidateStats.skipped += 1;
      candidateDaypartRouteStats.skipped += 1;
      continue;
    }
    const coherentCandidate = reconcileForecastCoherence(
      candidateEstimate,
      target.totalCapacity
    );
    const candidateAvailable =
      coherentCandidate.driveUpCapacity +
      (coherentCandidate.reservableCapacity ?? 0);
    addSample(
      candidateStats,
      getAvailableCapacity(target),
      candidateAvailable,
      target.totalCapacity,
      coherentCandidate.fullProbability ?? 0,
      coherentCandidate.fullRisk ?? "low",
      candidateEstimate.routeClass,
      candidateEstimate.demandShockAdjustment
    );
    addSample(
      candidateDaypartRouteStats,
      getAvailableCapacity(target),
      candidateAvailable,
      target.totalCapacity,
      coherentCandidate.fullProbability ?? 0,
      coherentCandidate.fullRisk ?? "low",
      candidateEstimate.routeClass,
      candidateEstimate.demandShockAdjustment
    );
  }
  const baselineReports = createBacktestReportSet(
    routeStats,
    daypartStats,
    year
  );
  let comparison: BacktestComparison | undefined;
  // build paired candidate reports
  if (options.compareDemandShock) {
    const candidateReports = createBacktestReportSet(
      candidateRouteStats,
      candidateDaypartStats,
      year
    );
    const baselineDigest = baselineSnapshotHash.digest("hex");
    const candidateDigest = candidateSnapshotHash.digest("hex");
    const baselineAsOfDigest = baselineAsOfHash.digest("hex");
    const candidateAsOfDigest = candidateAsOfHash.digest("hex");
    const baselineCapacityDigest = baselineCapacityHash.digest("hex");
    const candidateCapacityDigest = candidateCapacityHash.digest("hex");
    const invariants: BacktestComparison["invariants"] = {
      asOfMatch: baselineAsOfDigest === candidateAsOfDigest,
      baseComparableDigest: baselineDigest,
      baseComparableDigestMatch: baselineDigest === candidateDigest,
      targetCapacityMatch: baselineCapacityDigest === candidateCapacityDigest,
      targetCountMatch:
        baselineReports.overall.count === candidateReports.overall.count,
    };
    comparison = {
      baseline: baselineReports,
      candidate: candidateReports,
      failures: getPairedFailures(
        options,
        baselineReports.overall,
        candidateReports.overall,
        invariants
      ),
      invariants,
    };
  }
  const summary: BacktestSummary = {
    adjustmentMode: options.compareDemandShock
      ? "paired-demand-shock"
      : "historical-calendar-baseline",
    comparison,
    dayparts: baselineReports.dayparts,
    from: options.from.toISODate() ?? "",
    overall: baselineReports.overall,
    routes: baselineReports.routes,
    to: options.to.minus({ days: 1 }).toISODate() ?? "",
  };
  // persist calibration guard
  if (options.persistCalibration) {
    await persistCalibration(
      [...summary.routes, ...summary.dayparts],
      ForecastCalibration
    );
  }
  // json output guard
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
  // assertion guard
  if (options.assertThresholds) {
    assertThresholds(summary.overall);
    // assert the paired candidate
    if (comparison) {
      assertThresholds(comparison.candidate.overall);
      // paired failure guard
      if (comparison.failures.length > 0) {
        throw new Error(
          `Forecast demand-shock comparison failed: ${comparison.failures.join(
            "; "
          )}`
        );
      }
    }
  }
};

run()
  .catch((error: Error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const helpRequested =
      process.argv.includes("--help") || process.argv.includes("-h");
    // unopened database guard
    if (helpRequested) {
      return;
    }
    const { db } = runtimeRequire("../lib/db") as typeof import("../lib/db");
    await db.close();
  });
