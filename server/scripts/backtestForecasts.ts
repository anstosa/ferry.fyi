import { DateTime } from "luxon";
import { createRequire } from "module";
import { Op } from "sequelize";
import { constrain, round } from "shared/lib/math";

import type { HolidayDateMap } from "../lib/forecast";
import {
  type ForecastDaypart,
  getForecastDaypart,
} from "../lib/forecastDaypart";
import { FORECAST_REGRESSION_THRESHOLDS } from "../lib/forecastRegressionThresholds";

const DEFAULT_YEAR = 2025;
const HISTORY_YEARS = 2;
const FULL_AVAILABLE_THRESHOLD = 0.02;
const LOW_MISS_THRESHOLD = 20;
const HIGH_MISS_THRESHOLD = 50;
const DEFAULT_MAX_CANDIDATES = 5;
const runtimeRequire = createRequire(__filename);
const CROSSING_ATTRIBUTES = [
  "arrivalId",
  "departureId",
  "departureTime",
  "driveUpCapacity",
  "hasReservations",
  "isCancelled",
  "reservableCapacity",
  "totalCapacity",
];

interface BacktestOptions {
  from: DateTime;
  assertThresholds: boolean;
  json: boolean;
  limit: number | null;
  maxCandidates: number;
  persistCalibration: boolean;
  pair: string | null;
  useCalibration: boolean;
  to: DateTime;
}

interface BacktestCrossing {
  arrivalId: string;
  departureId: string;
  departureTime: number;
  driveUpCapacity: number;
  hasReservations: boolean;
  isCancelled: boolean;
  reservableCapacity: number;
  totalCapacity: number;
}

interface RouteStats {
  actualFull: number;
  count: number;
  forecastFull: number;
  highMisses: number;
  highFull: number;
  likelyFull: number;
  lowMisses: number;
  unlikelyFull: number;
  p90Errors: number[];
  routeClassCounts: Record<string, number>;
  skipped: number;
  totalAbsoluteError: number;
}

interface BacktestSummary {
  adjustmentMode: string;
  dayparts: RouteReport[];
  from: string;
  overall: RouteReport;
  routes: RouteReport[];
  to: string;
}

interface RouteReport {
  actualFull: number;
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
  unlikelyFull: number;
  p90: number;
  pair: string;
  routeClass: string;
  skipped: number;
  year: number;
}

type HistoryIndex = Map<string, Map<number, BacktestCrossing[]>>;

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
    from: getArgValue(args, "--from")
      ? parseDate(getArgValue(args, "--from") ?? "", defaultFrom)
      : defaultFrom,
    json: args.includes("--json"),
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
    `Usage: yarn forecast:backtest [--year 2025] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--pair departure-arrival] [--limit N] [--max-candidates N] [--json] [--assert] [--persist-calibration] [--use-calibration]\n\nRuns the committed historical/calendar forecast estimator against confirmed DB crossings and summarizes all terminal-pair directions. Weather and tide presentation are intentionally outside this baseline mode.`
  );
};

// pair key
const getPairKey = (crossing: BacktestCrossing): string =>
  `${crossing.departureId}-${crossing.arrivalId}`;

// available capacity
const getAvailableCapacity = (crossing: BacktestCrossing): number =>
  crossing.driveUpCapacity + (crossing.reservableCapacity ?? 0);

// route stats factory
const createRouteStats = (): RouteStats => ({
  actualFull: 0,
  count: 0,
  forecastFull: 0,
  highMisses: 0,
  highFull: 0,
  likelyFull: 0,
  lowMisses: 0,
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
  fullRisk: string,
  routeClass: string
): void => {
  const absoluteError = Math.abs(forecastAvailable - actualAvailable);
  stats.count += 1;
  stats.totalAbsoluteError += absoluteError;
  stats.p90Errors.push(absoluteError);
  stats.routeClassCounts[routeClass] =
    (stats.routeClassCounts[routeClass] ?? 0) + 1;
  // actual full guard
  if (actualAvailable <= totalCapacity * FULL_AVAILABLE_THRESHOLD) {
    stats.actualFull += 1;
  }
  // forecast full guard
  if (forecastAvailable <= totalCapacity * FULL_AVAILABLE_THRESHOLD) {
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
    unlikelyFull: stats.unlikelyFull,
    p90: round(getP90(stats.p90Errors), 1),
    pair,
    routeClass: getDominantRouteClass(stats),
    skipped: stats.skipped,
    year,
  };
};

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

// history index build
const buildHistoryIndex = (crossings: BacktestCrossing[]): HistoryIndex => {
  const index: HistoryIndex = new Map();
  // crossing index loop
  crossings.forEach((crossing) => {
    const pair = getPairKey(crossing);
    const { hour } = DateTime.fromSeconds(crossing.departureTime);
    const hourIndex = index.get(pair) ?? new Map<number, BacktestCrossing[]>();
    hourIndex.set(hour, [...(hourIndex.get(hour) ?? []), crossing]);
    index.set(pair, hourIndex);
  });
  // bucket sort loop
  index.forEach((hourIndex) => {
    hourIndex.forEach((bucket, hour) => {
      hourIndex.set(
        hour,
        bucket.sort((left, right) => left.departureTime - right.departureTime)
      );
    });
  });
  return index;
};

// prior index lookup
const getPriorIndex = (
  crossings: BacktestCrossing[],
  departureTime: number
): number => {
  let low = 0;
  let high = crossings.length;
  // binary search loop
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    // upper half guard
    if (crossings[middle].departureTime < departureTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

// estimator candidate filter
const getBacktestCandidates = (
  target: BacktestCrossing,
  historyIndex: HistoryIndex,
  maxCandidates: number
): BacktestCrossing[] => {
  const targetTime = DateTime.fromSeconds(target.departureTime);
  const pairIndex = historyIndex.get(getPairKey(target));
  // missing pair guard
  if (!pairIndex) {
    return [];
  }
  const candidates: BacktestCrossing[] = [];
  // nearby hour scan
  for (let hourOffset = -2; hourOffset <= 2; hourOffset++) {
    const hour = (targetTime.hour + hourOffset + 24) % 24;
    const bucket = pairIndex.get(hour) ?? [];
    const priorIndex = getPriorIndex(bucket, target.departureTime);
    candidates.push(
      ...bucket.slice(Math.max(0, priorIndex - maxCandidates), priorIndex)
    );
  }
  return candidates;
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
    `overall,count=${summary.overall.count},mae=${summary.overall.mae},p90=${summary.overall.p90},actualFull=${summary.overall.actualFull},forecastFull=${summary.overall.forecastFull},unlikelyFull=${summary.overall.unlikelyFull},likelyFull=${summary.overall.likelyFull},highFull=${summary.overall.highFull},lowMisses=${summary.overall.lowMisses},highMisses=${summary.overall.highMisses},lowMissRate=${summary.overall.lowMissRate},highMissRate=${summary.overall.highMissRate},fullBias=${summary.overall.fullBias},skipped=${summary.overall.skipped}`
  );
};

// threshold assertion
const assertThresholds = (summary: BacktestSummary): void => {
  const failures = [
    summary.overall.mae > FORECAST_REGRESSION_THRESHOLDS.mae
      ? `mae ${summary.overall.mae} > ${FORECAST_REGRESSION_THRESHOLDS.mae}`
      : null,
    summary.overall.p90 > FORECAST_REGRESSION_THRESHOLDS.p90
      ? `p90 ${summary.overall.p90} > ${FORECAST_REGRESSION_THRESHOLDS.p90}`
      : null,
    summary.overall.lowMissRate > FORECAST_REGRESSION_THRESHOLDS.lowMissRate
      ? `lowMissRate ${summary.overall.lowMissRate} > ${FORECAST_REGRESSION_THRESHOLDS.lowMissRate}`
      : null,
    summary.overall.highMissRate > FORECAST_REGRESSION_THRESHOLDS.highMissRate
      ? `highMissRate ${summary.overall.highMissRate} > ${FORECAST_REGRESSION_THRESHOLDS.highMissRate}`
      : null,
  ].filter((failure): failure is string => Boolean(failure));
  // failure guard
  if (failures.length > 0) {
    throw new Error(
      `Forecast regression thresholds failed: ${failures.join("; ")}`
    );
  }
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
  const { getHistoricalEstimate } = runtimeRequire(
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
  const historyIndex = buildHistoryIndex(history as BacktestCrossing[]);
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
  // target sweep
  for (const target of targets as BacktestCrossing[]) {
    const pair = getPairKey(target);
    const targetTime = DateTime.fromSeconds(target.departureTime);
    const daypart = getForecastDaypart(targetTime);
    const daypartKey = `${pair}::${daypart}`;
    const stats = routeStats.get(pair) ?? createRouteStats();
    const daypartRouteStats =
      daypartStats.get(daypartKey) ?? createRouteStats();
    routeStats.set(pair, stats);
    daypartStats.set(daypartKey, daypartRouteStats);
    const terminal = Terminal.getByIndex(target.departureId);
    const pairHistory = getBacktestCandidates(
      target,
      historyIndex,
      options.maxCandidates
    ) as Parameters<typeof getHistoricalEstimate>[1];
    const estimate = getHistoricalEstimate(
      targetTime,
      pairHistory,
      terminal,
      DateTime.fromSeconds(target.departureTime),
      holidays,
      target.totalCapacity,
      {
        arrivalId: target.arrivalId,
        calibration:
          calibrationByPair.get(daypartKey) ??
          calibrationByPair.get(`${pair}::all`),
        departureId: target.departureId,
        events: demandEvents,
      }
    );
    // missing estimate guard
    if (!estimate) {
      stats.skipped += 1;
      daypartRouteStats.skipped += 1;
      continue;
    }
    addSample(
      stats,
      getAvailableCapacity(target),
      estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0),
      target.totalCapacity,
      estimate.fullRisk,
      estimate.routeClass
    );
    addSample(
      daypartRouteStats,
      getAvailableCapacity(target),
      estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0),
      target.totalCapacity,
      estimate.fullRisk,
      estimate.routeClass
    );
  }
  const overallStats = createRouteStats();
  // route merge
  routeStats.forEach((stats) => {
    overallStats.actualFull += stats.actualFull;
    overallStats.count += stats.count;
    overallStats.forecastFull += stats.forecastFull;
    overallStats.highMisses += stats.highMisses;
    overallStats.highFull += stats.highFull;
    overallStats.likelyFull += stats.likelyFull;
    overallStats.lowMisses += stats.lowMisses;
    overallStats.unlikelyFull += stats.unlikelyFull;
    overallStats.p90Errors.push(...stats.p90Errors);
    // route class merge
    Object.entries(stats.routeClassCounts).forEach(([routeClass, count]) => {
      overallStats.routeClassCounts[routeClass] =
        (overallStats.routeClassCounts[routeClass] ?? 0) + count;
    });
    overallStats.skipped += stats.skipped;
    overallStats.totalAbsoluteError += stats.totalAbsoluteError;
  });
  const summary = {
    adjustmentMode: "historical-calendar-baseline",
    dayparts: Array.from(daypartStats.entries())
      .map(([key, stats]) => {
        const [pair, daypart] = key.split("::");
        return toRouteReport(pair, stats, year, daypart as ForecastDaypart);
      })
      .sort((left, right) => right.count - left.count),
    from: options.from.toISODate() ?? "",
    overall: toRouteReport("overall", overallStats, year),
    routes: Array.from(routeStats.entries())
      .map(([pair, stats]) => toRouteReport(pair, stats, year))
      .sort((left, right) => right.count - left.count),
    to: options.to.minus({ days: 1 }).toISODate() ?? "",
  };
  // persist calibration guard
  if (options.persistCalibration) {
    await persistCalibration(
      [...summary.routes, ...summary.dayparts],
      ForecastCalibration
    );
  }
  // assertion guard
  if (options.assertThresholds) {
    assertThresholds(summary);
  }
  // json output guard
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
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
