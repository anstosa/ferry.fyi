#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  calculateAvailability,
  calculateSourceAge,
  OBSERVABILITY_SCHEMA_VERSION,
  percentile,
  rate,
} from "../shared/lib/observability.ts";

const HTTP_KEYS = new Set([
  "completionOutcome",
  "durationMs",
  "event",
  "methodClass",
  "release",
  "routeClass",
  "schemaVersion",
  "statusClass",
]);
const OPERATION_KEYS = new Set([
  "cadenceMs",
  "event",
  "lagMs",
  "observedAt",
  "operation",
  "outcome",
  "release",
  "schemaVersion",
]);
const HTTP_OUTCOMES = new Set(["completed", "failed", "incomplete"]);
const HTTP_STATUSES = new Set(["1xx", "2xx", "3xx", "4xx", "5xx", "429"]);
const OPERATION_OUTCOMES = new Set([
  "failed",
  "never-run",
  "overdue",
  "running",
  "stale",
  "succeeded",
]);
const CATEGORY = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const REQUIRED_CANONICAL_CHECKS = new Map([
  ["/healthz", 200],
  ["/about", 200],
  ["/robots.txt", 200],
  ["/sitemap.xml", 200],
  ["/llms.txt", 200],
  ["/api/features", 200],
]);

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.has(key));

export const parseTelemetryJsonl = (contents) => {
  const events = [];
  let invalidSamples = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!isObject(event)) throw new Error("not an object");
      if (event.event === "public_http_request") {
        if (
          !hasOnlyKeys(event, HTTP_KEYS) ||
          event.schemaVersion !== OBSERVABILITY_SCHEMA_VERSION ||
          !CATEGORY.test(event.routeClass) ||
          !CATEGORY.test(event.methodClass) ||
          !HTTP_STATUSES.has(event.statusClass) ||
          !HTTP_OUTCOMES.has(event.completionOutcome) ||
          !CATEGORY.test(event.release) ||
          !Number.isFinite(event.durationMs) ||
          event.durationMs < 0
        ) {
          throw new Error("invalid HTTP event");
        }
      } else if (event.event === "scheduled_operation") {
        if (
          !hasOnlyKeys(event, OPERATION_KEYS) ||
          event.schemaVersion !== OBSERVABILITY_SCHEMA_VERSION ||
          !CATEGORY.test(event.operation) ||
          !CATEGORY.test(event.release) ||
          !OPERATION_OUTCOMES.has(event.outcome) ||
          !Number.isFinite(Date.parse(event.observedAt)) ||
          !Number.isFinite(event.cadenceMs) ||
          event.cadenceMs <= 0 ||
          (event.lagMs !== null &&
            (!Number.isFinite(event.lagMs) || event.lagMs < 0))
        ) {
          throw new Error("invalid operation event");
        }
      } else {
        throw new Error("unsupported event");
      }
      events.push(event);
    } catch {
      invalidSamples += 1;
    }
  }
  return { events, invalidSamples };
};

const summarizeHttp = (events, invalidSamples) => {
  const routeClasses = {};
  for (const event of events.filter(
    (candidate) => candidate.event === "public_http_request"
  )) {
    const current = routeClasses[event.routeClass] ?? {
      completedDurations: [],
      failedRequests: 0,
      incompleteRequests: 0,
      limitedRequests: 0,
      serverErrorRequests: 0,
      totalRequests: 0,
    };
    current.totalRequests += 1;
    if (event.completionOutcome === "completed") {
      current.completedDurations.push(event.durationMs);
    } else if (event.completionOutcome === "failed") {
      current.failedRequests += 1;
    } else {
      current.incompleteRequests += 1;
    }
    if (event.statusClass === "5xx") current.serverErrorRequests += 1;
    if (event.statusClass === "429") current.limitedRequests += 1;
    routeClasses[event.routeClass] = current;
  }
  return {
    invalidSamples,
    routeClasses: Object.fromEntries(
      Object.entries(routeClasses)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([routeClass, value]) => [
          routeClass,
          {
            completedRequests: value.completedDurations.length,
            failedRequests: value.failedRequests,
            incompleteRequests: value.incompleteRequests,
            latencyMs: {
              p50: percentile(value.completedDurations, 0.5),
              p95: percentile(value.completedDurations, 0.95),
              p99: percentile(value.completedDurations, 0.99),
            },
            rateLimitedRate: rate(value.limitedRequests, value.totalRequests),
            serverErrorRate: rate(
              value.serverErrorRequests,
              value.totalRequests
            ),
            totalRequests: value.totalRequests,
          },
        ])
    ),
  };
};

const checkMap = (receipt) =>
  new Map(
    Array.isArray(receipt?.checks)
      ? receipt.checks.map((check) => [check.path, check.status])
      : []
  );

const canonicalSucceeded = (receipt) => {
  if (receipt?.outcome !== "passed") return false;
  const checks = checkMap(receipt);
  return [...REQUIRED_CANONICAL_CHECKS].every(
    ([checkPath, status]) => checks.get(checkPath) === status
  );
};

const readinessSucceeded = (receipt) =>
  receipt?.outcome === "passed" && checkMap(receipt).get("/readyz") === 200;

const summarizeSynthetics = (bundle) => {
  const receipts = Array.isArray(bundle?.receipts) ? bundle.receipts : [];
  const scheduledAttempts = bundle?.scheduledAttempts ?? receipts.length;
  const readinessScheduledAttempts =
    bundle?.readinessScheduledAttempts ?? scheduledAttempts;
  const plannedMaintenanceAttempts = bundle?.plannedMaintenanceAttempts ?? 0;
  const evidencedMonitorOutageAttempts =
    bundle?.evidencedMonitorOutageAttempts ?? 0;
  const canonicalObserved = receipts.length;
  const readinessObserved = receipts.filter((receipt) =>
    checkMap(receipt).has("/readyz")
  ).length;
  return {
    canonical: calculateAvailability({
      evidencedMonitorOutageAttempts,
      observedAttempts: canonicalObserved,
      plannedMaintenanceAttempts,
      scheduledAttempts,
      successfulAttempts: receipts.filter(canonicalSucceeded).length,
    }),
    readiness: calculateAvailability({
      evidencedMonitorOutageAttempts,
      observedAttempts: readinessObserved,
      plannedMaintenanceAttempts,
      scheduledAttempts: readinessScheduledAttempts,
      successfulAttempts: receipts.filter(readinessSucceeded).length,
    }),
  };
};

const summarizeSourceAge = (bundle) => {
  const classes = {};
  const samples = (bundle?.receipts ?? []).flatMap(
    (receipt) => receipt.sourceSamples ?? []
  );
  for (const sample of samples) {
    const name = CATEGORY.test(sample?.name) ? sample.name : "invalid-category";
    const current = classes[name] ?? { ages: [], outcomes: {} };
    const result = calculateSourceAge({
      retrievedAt: sample?.retrievedAt,
      sourceTimestamp: sample?.sourceTimestamp,
    });
    current.outcomes[result.outcome] =
      (current.outcomes[result.outcome] ?? 0) + 1;
    if (result.outcome === "valid") current.ages.push(result.ageMs);
    classes[name] = current;
  }
  return Object.fromEntries(
    Object.entries(classes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [
        name,
        {
          invalidSamples:
            Object.entries(value.outcomes)
              .filter(([outcome]) => outcome !== "valid")
              .reduce((sum, [, count]) => sum + count, 0),
          outcomes: value.outcomes,
          validAgeMs: {
            p50: percentile(value.ages, 0.5),
            p95: percentile(value.ages, 0.95),
            p99: percentile(value.ages, 0.99),
          },
          validSamples: value.ages.length,
        },
      ])
  );
};

const summarizeOperations = (events) => {
  const operations = {};
  for (const event of events.filter(
    (candidate) => candidate.event === "scheduled_operation"
  )) {
    const current = operations[event.operation] ?? {};
    current[event.outcome] = (current[event.outcome] ?? 0) + 1;
    operations[event.operation] = current;
  }
  return Object.fromEntries(
    Object.entries(operations).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
};

export const summarizeRuntimeObservability = ({
  events,
  invalidSamples = 0,
  syntheticBundle = {},
}) => ({
  attainment: "not-assessed-requires-complete-production-window",
  http: summarizeHttp(events, invalidSamples),
  hydration: { classification: "diagnostic", sli: false },
  kind: "runtime-observability-summary",
  operations: summarizeOperations(events),
  schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
  sourceAge: summarizeSourceAge(syntheticBundle),
  synthetics: summarizeSynthetics(syntheticBundle),
});

const parseArgs = (argv) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    args.set(argv[index], argv[index + 1]);
  }
  return args;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const logs = args.get("--logs");
  const synthetics = args.get("--synthetics");
  const output = args.get("--output");
  if (!logs || !synthetics) {
    throw new Error("--logs and --synthetics are required");
  }
  const parsed = parseTelemetryJsonl(fs.readFileSync(logs, "utf8"));
  const syntheticBundle = JSON.parse(fs.readFileSync(synthetics, "utf8"));
  const summary = summarizeRuntimeObservability({
    events: parsed.events,
    invalidSamples: parsed.invalidSamples,
    syntheticBundle,
  });
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized);
  }
  process.stdout.write(serialized);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
