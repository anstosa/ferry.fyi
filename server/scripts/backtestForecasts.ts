import { DateTime } from "luxon";
import { createRequire } from "module";
import { Op } from "sequelize";
import { round } from "shared/lib/math";

import type { HolidayDateMap } from "../lib/forecast";

const DEFAULT_YEAR = 2025;
const HISTORY_YEARS = 2;
const FULL_AVAILABLE_THRESHOLD = 0.02;
const LOW_MISS_THRESHOLD = 20;
const HIGH_MISS_THRESHOLD = 50;
const runtimeRequire = createRequire(__filename);

interface BacktestOptions {
  from: DateTime;
  json: boolean;
  limit: number | null;
  pair: string | null;
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
  likelyFull: number;
  lowMisses: number;
  maybeFull: number;
  p90Errors: number[];
  routeClassCounts: Record<string, number>;
  skipped: number;
  totalAbsoluteError: number;
}

interface BacktestSummary {
  from: string;
  overall: RouteReport;
  routes: RouteReport[];
  to: string;
}

interface RouteReport {
  actualFull: number;
  count: number;
  forecastFull: number;
  highMisses: number;
  likelyFull: number;
  lowMisses: number;
  mae: number;
  maybeFull: number;
  p90: number;
  pair: string;
  routeClass: string;
  skipped: number;
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
    from: getArgValue(args, "--from")
      ? parseDate(getArgValue(args, "--from") ?? "", defaultFrom)
      : defaultFrom,
    json: args.includes("--json"),
    limit: getArgValue(args, "--limit")
      ? Number(getArgValue(args, "--limit"))
      : null,
    pair: getArgValue(args, "--pair"),
    to: getArgValue(args, "--to")
      ? parseDate(getArgValue(args, "--to") ?? "", defaultTo).plus({ days: 1 })
      : defaultTo,
  };
};

// help output
const printHelp = (): void => {
  console.log(
    `Usage: yarn forecast:backtest [--year 2025] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--pair departure-arrival] [--limit N] [--json]\n\nRuns the committed forecast estimator against confirmed DB crossings and summarizes all terminal-pair directions.`
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
  likelyFull: 0,
  lowMisses: 0,
  maybeFull: 0,
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
  // maybe full guard
  if (fullRisk === "maybe") {
    stats.maybeFull += 1;
  }
  // likely full guard
  if (fullRisk === "likely") {
    stats.likelyFull += 1;
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
const toRouteReport = (pair: string, stats: RouteStats): RouteReport => ({
  actualFull: stats.actualFull,
  count: stats.count,
  forecastFull: stats.forecastFull,
  highMisses: stats.highMisses,
  likelyFull: stats.likelyFull,
  lowMisses: stats.lowMisses,
  mae: stats.count ? round(stats.totalAbsoluteError / stats.count, 1) : 0,
  maybeFull: stats.maybeFull,
  p90: round(getP90(stats.p90Errors), 1),
  pair,
  routeClass: getDominantRouteClass(stats),
  skipped: stats.skipped,
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

// route grouping
const groupByPair = (
  crossings: BacktestCrossing[]
): Map<string, BacktestCrossing[]> => {
  const grouped = new Map<string, BacktestCrossing[]>();
  // crossing grouping
  crossings.forEach((crossing) => {
    const key = getPairKey(crossing);
    grouped.set(key, [...(grouped.get(key) ?? []), crossing]);
  });
  return grouped;
};

// summary rendering
const printSummary = (summary: BacktestSummary): void => {
  console.log(`Forecast backtest ${summary.from} through ${summary.to}`);
  console.log(
    "pair,count,mae,p90,actualFull,forecastFull,maybeFull,likelyFull,lowMisses,highMisses,routeClass,skipped"
  );
  // route output
  summary.routes.forEach((route) => {
    console.log(
      [
        route.pair,
        route.count,
        route.mae,
        route.p90,
        route.actualFull,
        route.forecastFull,
        route.maybeFull,
        route.likelyFull,
        route.lowMisses,
        route.highMisses,
        route.routeClass,
        route.skipped,
      ].join(",")
    );
  });
  console.log(
    `overall,count=${summary.overall.count},mae=${summary.overall.mae},p90=${summary.overall.p90},actualFull=${summary.overall.actualFull},forecastFull=${summary.overall.forecastFull},maybeFull=${summary.overall.maybeFull},likelyFull=${summary.overall.likelyFull},lowMisses=${summary.overall.lowMisses},highMisses=${summary.overall.highMisses},skipped=${summary.overall.skipped}`
  );
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
  const terminalModule = runtimeRequire(
    "../models/Terminal"
  ) as typeof import("../models/Terminal");
  const Crossing = crossingModule.default;
  const { Terminal } = terminalModule;
  const options = parseOptions();
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
  const [targets, history, holidays] = await Promise.all([
    Crossing.findAll({ order: [["departureTime", "ASC"]], where }),
    Crossing.findAll({
      order: [["departureTime", "ASC"]],
      where: historyWhere,
    }),
    loadHolidayMap(
      options.from,
      options.to,
      holidayModule.getWashingtonHolidayDates
    ),
  ]);
  const routeHistory = groupByPair(history as BacktestCrossing[]);
  const routeStats = new Map<string, RouteStats>();
  const limitedTargets = options.limit
    ? targets.slice(0, options.limit)
    : targets;
  // target sweep
  for (const target of limitedTargets as BacktestCrossing[]) {
    const pair = getPairKey(target);
    const stats = routeStats.get(pair) ?? createRouteStats();
    routeStats.set(pair, stats);
    const terminal = Terminal.getByIndex(target.departureId);
    const pairHistory = (routeHistory.get(pair) ?? []) as Parameters<
      typeof getHistoricalEstimate
    >[1];
    const estimate = getHistoricalEstimate(
      DateTime.fromSeconds(target.departureTime),
      pairHistory,
      terminal,
      DateTime.fromSeconds(target.departureTime),
      holidays,
      target.totalCapacity
    );
    // missing estimate guard
    if (!estimate) {
      stats.skipped += 1;
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
  }
  const overallStats = createRouteStats();
  // route merge
  routeStats.forEach((stats) => {
    overallStats.actualFull += stats.actualFull;
    overallStats.count += stats.count;
    overallStats.forecastFull += stats.forecastFull;
    overallStats.highMisses += stats.highMisses;
    overallStats.likelyFull += stats.likelyFull;
    overallStats.lowMisses += stats.lowMisses;
    overallStats.maybeFull += stats.maybeFull;
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
    from: options.from.toISODate() ?? "",
    overall: toRouteReport("overall", overallStats),
    routes: Array.from(routeStats.entries())
      .map(([pair, stats]) => toRouteReport(pair, stats))
      .sort((left, right) => right.count - left.count),
    to: options.to.minus({ days: 1 }).toISODate() ?? "",
  };
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
