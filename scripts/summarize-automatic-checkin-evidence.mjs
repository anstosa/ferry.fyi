#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

import { AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES } from "../shared/contracts/leaderboards.ts";

const SCHEMA_VERSION = 1;
const ONE_SIDED_Z_95 = 1.6448536269514722;
const TWO_SIDED_Z_95 = 1.959963984540054;
const COHORT = /^cohort-[a-z]$/;
const RELEASE = /^[0-9a-f]{7,12}$/;
const VERSION = /^\d+\.\d+(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;
const UINT32_MAX = 0xffffffff;
const BUILD_KEYS = new Set([
  "configGeneration",
  "localWorkCohort",
  "release",
  "serverPolicyGeneration",
  "version",
]);
const CELL_KEYS = new Set([
  "accuracyBuckets",
  "artifactLinks",
  "attempts",
  "batteryControls",
  "batteryDeltasPercentagePoints",
  "delayBuckets",
  "detector",
  "deviceClass",
  "duplicateCredits",
  "expiredCredits",
  "failureOutcomes",
  "falseCredits",
  "gate",
  "invariantBreaches",
  "lifecycle",
  "osClass",
  "osReleaseChannel",
  "outcomeBuckets",
  "platform",
  "privacyResult",
  "scenario",
  "successes",
]);
const ROOT_KEYS = new Set(["build", "cells", "schemaVersion"]);
const PLATFORMS = new Set(["android", "ios"]);
const OS_CLASSES = new Set([
  "android-api26",
  "android-api27",
  "android-api28",
  "android-api29",
  "android-api30",
  "android-api31",
  "android-api32",
  "android-api33",
  "android-api34",
  "android-api35",
  "android-api36",
  "android-api37",
  "ios-15",
  "ios-16",
  "ios-17",
  "ios-18",
  "ios-19",
  "ios-20",
  "ios-21",
  "ios-22",
  "ios-23",
  "ios-24",
  "ios-25",
  "ios-26",
  "ios-27",
]);
const DEVICE_CLASSES = new Set([
  "android-emulator",
  "ios-simulator",
  "iphone",
  "pixel",
  "samsung",
]);
const LIFECYCLES = new Set([
  "background",
  "bar-off",
  "first-unlock",
  "force-quit",
  "force-stop",
  "foreground",
  "offline-online",
  "process-death",
  "reboot",
  "screen-off",
  "settings-recovery",
]);
const DETECTORS = new Set(["terminal", "vessel"]);
const GATES = new Set(["r1-pilot", "r1-release", "t0", "v0", "v1"]);
const SCENARIOS = new Set([
  "backup-restore",
  "battery-ferry-leg",
  "battery-stationary",
  "battery-terminal-area",
  "clean-install",
  "config-at-budget",
  "config-over-budget",
  "config-registration-failure",
  "credential-revoked",
  "device-transfer",
  "drive-by-terminal",
  "expired-candidate",
  "ferry-not-boarded",
  "geofence-unavailable",
  "history-gap",
  "identity-loss",
  "location-services-off",
  "low-accuracy",
  "malformed-fleet-context",
  "manual-fallback",
  "near-shore-vessel",
  "permission-denied",
  "permission-revoked",
  "policy-race",
  "privacy-canary",
  "queue-overflow",
  "reduced-accuracy",
  "reinstall",
  "replay-modified",
  "stale-fleet-context",
  "terminal-boundary",
  "terminal-dwell",
  "terminal-enter-exit",
  "terminal-rapid-transition",
  "vessel-diagnostic",
  "wrong-sailing",
]);
const BATTERY_CONTROL_KEYS = new Set([
  "energyDiagnostic",
  "networkState",
  "randomizedOrder",
  "screenState",
  "thermalState",
]);
const ENERGY_DIAGNOSTICS = new Set([
  "android-batterystats",
  "android-studio-profiler",
  "xcode-energy-log",
  "xcode-organizer",
]);
const NETWORK_STATES = new Set(["cellular", "mixed", "wifi"]);
const SCREEN_STATES = new Set(["fixed-on", "off"]);
const THERMAL_STATES = new Set(["critical", "elevated", "nominal"]);
const OS_RELEASE_CHANNELS = new Set(["beta", "stable"]);
const PRIVACY_RESULTS = new Set(["fail", "pass"]);
const DELAY_BUCKETS = new Set([
  "under-1m",
  "1m-to-5m",
  "5m-to-15m",
  "over-15m",
  "not-observed",
]);
const ACCURACY_BUCKETS = new Set([
  "under-25m",
  "25m-to-50m",
  "50m-to-100m",
  "over-100m",
  "not-observed",
]);
const FIXED_OUTCOMES = new Set([
  ...AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES,
  "ambiguous_vessel_match",
  "background_refresh_unavailable",
  "default_off",
  "diagnostic_candidate_wiped",
  "disabled",
  "fix_invalid",
  "fleet_context_prefetched",
  "location_invalid",
  "location_request_failed",
  "location_unavailable",
  "manual_fallback",
  "monitoring_failed",
  "monitoring_unavailable",
  "multiple_plausible_vessels",
  "not_applicable",
  "no_plausible_vessel",
  "no_vessel_match",
  "protected_data_unavailable",
  "terminal_entry_fix_observed",
  "terminal_fix_observed",
  "wake_already_active",
]);
const T_CRITICAL_95 = [
  Number.NaN,
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
];
const T_CRITICAL_ONE_SIDED_95 = [
  Number.NaN,
  6.314,
  2.92,
  2.353,
  2.132,
  2.015,
  1.943,
  1.895,
  1.86,
  1.833,
  1.812,
  1.796,
  1.782,
  1.771,
  1.761,
  1.753,
  1.746,
  1.74,
  1.734,
  1.729,
  1.725,
  1.721,
  1.717,
  1.714,
  1.711,
  1.708,
  1.706,
  1.703,
  1.701,
  1.699,
  1.697,
];

// identify one plain json object
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// reject unreviewed fields without reflecting their names or values
const requireExactKeys = (value, allowed, required = allowed) => {
  // require one plain object
  if (!isObject(value)) {
    throw new Error("invalid evidence schema");
  }
  const keys = Object.keys(value);
  // require only reviewed aggregate fields
  if (
    !keys.every((key) => allowed.has(key)) ||
    ![...required].every((key) => keys.includes(key))
  ) {
    throw new Error("invalid evidence schema");
  }
};

// require one bounded integer
const requireInteger = (value, minimum = 0) => {
  // reject fractional or unsafe evidence counts
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error("invalid evidence schema");
  }
  return value;
};

// require one unsigned shared-contract generation
const requireUint32 = (value, minimum = 0) => {
  const integer = requireInteger(value, minimum);
  // enforce the shared uint32 boundary
  if (integer > UINT32_MAX) {
    throw new Error("invalid evidence schema");
  }
  return integer;
};

// require one approved category
const requireCategory = (value, allowed) => {
  // reject free text and unknown categories
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error("invalid evidence schema");
  }
  return value;
};

// sum one fixed aggregate bucket map
const summarizeBuckets = (value, allowed, expectedTotal) => {
  requireExactKeys(value, allowed, new Set());
  const entries = Object.entries(value);
  // reject empty nonzero bucket reports
  if (entries.length === 0 && expectedTotal > 0) {
    throw new Error("invalid evidence schema");
  }
  // add reviewed bucket counts
  const total = entries.reduce((sum, [key, count]) => {
    // require reviewed bucket labels
    if (!allowed.has(key)) {
      throw new Error("invalid evidence schema");
    }
    return sum + requireInteger(count);
  }, 0);
  // bind every aggregate to the attempt count
  if (total !== expectedTotal) {
    throw new Error("invalid evidence schema");
  }
  // stabilize bucket ordering
  return Object.fromEntries(
    entries.sort(([left], [right]) => left.localeCompare(right))
  );
};

// derive successes from the complete and failed outcome buckets
const deriveSuccessOutcomes = (outcomeBuckets, failureOutcomes, successes) => {
  // reject failures absent from the complete outcome accounting
  for (const [outcome, failures] of Object.entries(failureOutcomes)) {
    if (failures > (outcomeBuckets[outcome] ?? 0)) {
      throw new Error("invalid evidence schema");
    }
  }
  // retain only nonzero successful outcome counts
  const successOutcomes = Object.fromEntries(
    Object.entries(outcomeBuckets).flatMap(([outcome, count]) => {
      const successfulCount = count - (failureOutcomes[outcome] ?? 0);
      // omit empty derived buckets
      return successfulCount === 0 ? [] : [[outcome, successfulCount]];
    })
  );
  // bind the derived success total to the claimed total
  if (
    Object.values(successOutcomes).reduce((sum, count) => sum + count, 0) !==
    successes
  ) {
    throw new Error("invalid evidence schema");
  }
  return successOutcomes;
};

// round stable report values
const rounded = (value) => Number(value.toFixed(6));

// approximate one finite-sample t quantile above the table
const approximateTCritical = (zScore, degreesOfFreedom) => {
  const inverseDegrees = 1 / degreesOfFreedom;
  const zCubed = zScore ** 3;
  const zFifth = zScore ** 5;
  const zSeventh = zScore ** 7;
  return (
    zScore +
    ((zCubed + zScore) * inverseDegrees) / 4 +
    ((5 * zFifth + 16 * zCubed + 3 * zScore) * inverseDegrees ** 2) / 96 +
    ((3 * zSeventh + 19 * zFifth + 17 * zCubed - 15 * zScore) *
      inverseDegrees ** 3) /
      384
  );
};

// calculate unrounded wilson bounds
const wilsonBounds = (successes, attempts, zScore) => {
  requireInteger(successes);
  requireInteger(attempts, 1);
  // reject impossible success counts
  if (successes > attempts) {
    throw new Error("invalid evidence schema");
  }
  const proportion = successes / attempts;
  const zSquared = zScore ** 2;
  const denominator = 1 + zSquared / attempts;
  const center = (proportion + zSquared / (2 * attempts)) / denominator;
  const margin =
    (zScore / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / attempts +
        zSquared / (4 * attempts ** 2)
    );
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
};

// format one wilson score interval
const wilsonInterval = (successes, attempts, zScore) => {
  const bounds = wilsonBounds(successes, attempts, zScore);
  return {
    lower: rounded(bounds.lower),
    method: "wilson-95",
    upper: rounded(bounds.upper),
  };
};

// calculate one two-sided wilson interval
export const wilson95 = (successes, attempts) => ({
  ...wilsonInterval(successes, attempts, TWO_SIDED_Z_95),
  method: "wilson-two-sided-95",
});

// calculate one release-facing lower confidence bound
export const wilsonLower95 = (successes, attempts) => ({
  lower: wilsonInterval(successes, attempts, ONE_SIDED_Z_95).lower,
  method: "wilson-one-sided-lower-95",
});

// retain exact bounds for release calculations
export const wilsonLowerBound95 = (successes, attempts) =>
  wilsonBounds(successes, attempts, ONE_SIDED_Z_95).lower;

// select one two-sided t critical value
const tCritical95 = (degreesOfFreedom) => {
  // use the finite-sample table when available
  if (degreesOfFreedom < T_CRITICAL_95.length) {
    return T_CRITICAL_95[degreesOfFreedom];
  }
  return approximateTCritical(TWO_SIDED_Z_95, degreesOfFreedom);
};

// select one one-sided t critical value
const tCriticalOneSided95 = (degreesOfFreedom) => {
  // use the finite-sample table when available
  if (degreesOfFreedom < T_CRITICAL_ONE_SIDED_95.length) {
    return T_CRITICAL_ONE_SIDED_95[degreesOfFreedom];
  }
  return approximateTCritical(ONE_SIDED_Z_95, degreesOfFreedom);
};

// calculate one paired battery summary
export const summarizeBattery = (samples) => {
  // require characterization's minimum paired runs
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error("invalid evidence schema");
  }
  // validate each paired delta
  const values = samples.map((sample) => {
    // bound percentage-point deltas
    if (!Number.isFinite(sample) || sample < -100 || sample > 100) {
      throw new Error("invalid evidence schema");
    }
    return sample;
  });
  // calculate the paired mean
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  // stabilize the paired order
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  // calculate the paired median
  const median =
    ordered.length % 2 === 0
      ? (ordered[midpoint - 1] + ordered[midpoint]) / 2
      : ordered[midpoint];
  // calculate paired variance
  const squaredDeviations = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0
  );
  const sampleStandardDeviation = Math.sqrt(
    squaredDeviations / (values.length - 1)
  );
  const margin =
    tCritical95(values.length - 1) *
    (sampleStandardDeviation / Math.sqrt(values.length));
  const upperMargin =
    tCriticalOneSided95(values.length - 1) *
    (sampleStandardDeviation / Math.sqrt(values.length));
  return {
    confidenceInterval95: {
      lower: rounded(mean - margin),
      method: "paired-t-95",
      upper: rounded(mean + margin),
    },
    meanPercentagePoints: rounded(mean),
    medianPercentagePoints: rounded(median),
    pairs: values.length,
    upperConfidenceBound95PercentagePoints: rounded(mean + upperMargin),
  };
};

// validate one paired battery control receipt
const summarizeBatteryControls = (value, hasBatterySamples) => {
  // bind control receipts to paired battery data
  if (!hasBatterySamples) {
    if (value !== null) {
      throw new Error("invalid evidence schema");
    }
    return null;
  }
  requireExactKeys(value, BATTERY_CONTROL_KEYS);
  // require an explicit randomized-order observation
  if (typeof value.randomizedOrder !== "boolean") {
    throw new Error("invalid evidence schema");
  }
  return {
    energyDiagnostic: requireCategory(
      value.energyDiagnostic,
      ENERGY_DIAGNOSTICS
    ),
    networkState: requireCategory(value.networkState, NETWORK_STATES),
    randomizedOrder: value.randomizedOrder,
    screenState: requireCategory(value.screenState, SCREEN_STATES),
    thermalState: requireCategory(value.thermalState, THERMAL_STATES),
  };
};

// validate privacy-safe artifact links
const summarizeLinks = (links) => {
  // require a bounded link list
  if (!Array.isArray(links) || links.length === 0 || links.length > 20) {
    throw new Error("invalid evidence schema");
  }
  // validate each artifact link
  return links.map((link) => {
    let parsed;
    // parse only explicit web evidence links
    try {
      parsed = new URL(link);
    } catch {
      // suppress untrusted parser detail
      throw new Error("invalid evidence schema");
    }
    // reject local files and embedded credentials
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    ) {
      throw new Error("invalid evidence schema");
    }
    return parsed.toString();
  });
};

// summarize one non-poolable evidence cell
const summarizeCell = (cell) => {
  const requiredCellKeys = new Set([...CELL_KEYS]);
  requireExactKeys(cell, CELL_KEYS, requiredCellKeys);
  const attempts = requireInteger(cell.attempts, 1);
  const successes = requireInteger(cell.successes);
  // reject impossible success totals
  if (successes > attempts) {
    throw new Error("invalid evidence schema");
  }
  const failureOutcomes = summarizeBuckets(
    cell.failureOutcomes,
    FIXED_OUTCOMES,
    attempts - successes
  );
  const outcomeBuckets = summarizeBuckets(
    cell.outcomeBuckets,
    FIXED_OUTCOMES,
    attempts
  );
  const successOutcomes = deriveSuccessOutcomes(
    outcomeBuckets,
    failureOutcomes,
    successes
  );
  const stopCounts = {
    duplicateCredits: requireInteger(cell.duplicateCredits),
    expiredCredits: requireInteger(cell.expiredCredits),
    falseCredits: requireInteger(cell.falseCredits),
    invariantBreaches: requireInteger(cell.invariantBreaches),
  };
  // apply the zero-tolerance stop boundary
  const stopRuleTriggered =
    cell.privacyResult !== "pass" ||
    Object.values(stopCounts).some((count) => count > 0);
  // reject impossible stop totals
  if (Object.values(stopCounts).some((count) => count > attempts)) {
    throw new Error("invalid evidence schema");
  }
  const platform = requireCategory(cell.platform, PLATFORMS);
  const osClass = requireCategory(cell.osClass, OS_CLASSES);
  const osReleaseChannel = requireCategory(
    cell.osReleaseChannel,
    OS_RELEASE_CHANNELS
  );
  const deviceClass = requireCategory(cell.deviceClass, DEVICE_CLASSES);
  const detector = requireCategory(cell.detector, DETECTORS);
  const gate = requireCategory(cell.gate, GATES);
  const scenario = requireCategory(cell.scenario, SCENARIOS);
  const hasBatterySamples = cell.batteryDeltasPercentagePoints !== null;
  const isBatteryScenario = scenario.startsWith("battery-");
  // keep battery trials separate from other physical scenarios
  if (hasBatterySamples !== isBatteryScenario) {
    throw new Error("invalid evidence schema");
  }
  const batteryControls = summarizeBatteryControls(
    cell.batteryControls,
    hasBatterySamples
  );
  const batteryProtocolPassed =
    !hasBatterySamples || batteryControls.randomizedOrder === true;
  // bind platform labels to exact os/device classes
  const platformMatches =
    platform === "android"
      ? osClass.startsWith("android-") &&
        ["android-emulator", "pixel", "samsung"].includes(deviceClass)
      : osClass.startsWith("ios-") &&
        ["ios-simulator", "iphone"].includes(deviceClass);
  // prevent cross-platform evidence relabeling
  if (!platformMatches) {
    throw new Error("invalid evidence schema");
  }
  // keep current preview evidence out of the stable Android matrix
  if (platform === "android" && osReleaseChannel !== "stable") {
    throw new Error("invalid evidence schema");
  }
  // keep the currently reviewed iOS preview from masquerading as stable
  if (osClass === "ios-27" && osReleaseChannel !== "beta") {
    throw new Error("invalid evidence schema");
  }
  const gateMatchesDetector =
    gate === "t0"
      ? detector === "terminal"
      : ["v0", "v1"].includes(gate)
        ? detector === "vessel"
        : true;
  // prevent terminal and vessel feasibility evidence from crossing gates
  if (!gateMatchesDetector) {
    throw new Error("invalid evidence schema");
  }
  const evidenceClass =
    deviceClass === "android-emulator"
      ? "emulator-supporting"
      : deviceClass === "ios-simulator"
        ? "simulator-supporting"
        : osReleaseChannel === "beta"
          ? "beta-supporting"
          : "physical-device";
  return {
    accuracyBuckets: summarizeBuckets(
      cell.accuracyBuckets,
      ACCURACY_BUCKETS,
      attempts
    ),
    artifactLinks: summarizeLinks(cell.artifactLinks),
    attempts,
    // omit absent battery characterization
    battery: hasBatterySamples
      ? {
          ...summarizeBattery(cell.batteryDeltasPercentagePoints),
          controls: batteryControls,
          protocol:
            batteryControls.randomizedOrder === true
              ? "paired-randomized"
              : "failed-not-randomized",
        }
      : null,
    delayBuckets: summarizeBuckets(cell.delayBuckets, DELAY_BUCKETS, attempts),
    detector,
    deviceClass,
    evidenceClass,
    failureOutcomes,
    gate,
    lifecycle: requireCategory(cell.lifecycle, LIFECYCLES),
    osClass,
    osReleaseChannel,
    outcomeBuckets,
    platform,
    privacyResult: requireCategory(cell.privacyResult, PRIVACY_RESULTS),
    scenario,
    // label smoke evidence without approving release
    provisionalCharacterization:
      evidenceClass !== "physical-device"
        ? "supporting-only-not-physical"
        : attempts >= 5 &&
            successes > 0 &&
            !stopRuleTriggered &&
            batteryProtocolPassed
          ? "observed-not-release-approved"
          : "insufficient-or-failed",
    stopCounts,
    stopRuleTriggered,
    successes,
    successOutcomes,
    successInterval95: wilson95(successes, attempts),
    successLowerConfidenceBound95: wilsonLower95(successes, attempts),
  };
};

// identify one immutable evidence stratum
const cellKey = (cell) =>
  [
    cell.platform,
    cell.osClass,
    cell.deviceClass,
    cell.gate,
    cell.lifecycle,
    cell.osReleaseChannel,
    cell.detector,
    cell.scenario,
  ].join("/");

// summarize one strict aggregate-only evidence bundle
export const summarizeAutomaticCheckinEvidence = (bundle) => {
  requireExactKeys(bundle, ROOT_KEYS);
  // require the frozen schema version
  if (
    bundle.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(bundle.cells) ||
    bundle.cells.length === 0
  ) {
    throw new Error("invalid evidence schema");
  }
  requireExactKeys(bundle.build, BUILD_KEYS);
  // require one safe build identity
  if (
    typeof bundle.build.version !== "string" ||
    !VERSION.test(bundle.build.version) ||
    typeof bundle.build.release !== "string" ||
    !RELEASE.test(bundle.build.release) ||
    typeof bundle.build.localWorkCohort !== "string" ||
    !COHORT.test(bundle.build.localWorkCohort)
  ) {
    throw new Error("invalid evidence schema");
  }
  // validate every non-poolable stratum
  const cells = bundle.cells.map(summarizeCell);
  // derive each stratum identity
  const keys = cells.map(cellKey);
  // prohibit implicit pooling of duplicate strata
  if (new Set(keys).size !== keys.length) {
    throw new Error("invalid evidence schema");
  }
  // combine only the stop decision
  const stopRuleTriggered = cells.some((cell) => cell.stopRuleTriggered);
  // stabilize cell ordering
  const orderedCells = cells.sort((left, right) =>
    cellKey(left).localeCompare(cellKey(right))
  );
  // preserve reviewed release authority
  const releaseGate = stopRuleTriggered
    ? "blocked-stop-rule"
    : "not-assessed-requires-reviewed-r1-amendment";
  return {
    build: {
      configGeneration: requireUint32(bundle.build.configGeneration, 1),
      localWorkCohort: bundle.build.localWorkCohort,
      release: bundle.build.release,
      serverPolicyGeneration: requireUint32(
        bundle.build.serverPolicyGeneration
      ),
      version: bundle.build.version,
    },
    cells: orderedCells,
    releaseGate,
    schemaVersion: SCHEMA_VERSION,
    stopRuleTriggered,
  };
};

// parse one command-line input/output pair
const parseArguments = (argumentsList) => {
  const inputIndex = argumentsList.indexOf("--input");
  const outputIndex = argumentsList.indexOf("--output");
  // require explicit paths and no extra arguments
  if (
    inputIndex < 0 ||
    outputIndex < 0 ||
    !argumentsList[inputIndex + 1] ||
    !argumentsList[outputIndex + 1] ||
    argumentsList.length !== 4
  ) {
    throw new Error("usage: --input <json> --output <json>");
  }
  return {
    input: argumentsList[inputIndex + 1],
    output: argumentsList[outputIndex + 1],
  };
};

// write one validated redacted report
const run = () => {
  const paths = parseArguments(process.argv.slice(2));
  const bundle = JSON.parse(fs.readFileSync(paths.input, "utf8"));
  const summary = summarizeAutomaticCheckinEvidence(bundle);
  fs.writeFileSync(paths.output, `${JSON.stringify(summary, null, 2)}\n`, {
    flag: "wx",
  });
};

// execute only as the command-line entrypoint
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    run();
  } catch {
    // keep cli failures detail-free
    process.stderr.write("automatic check-in evidence rejected\n");
    process.exitCode = 1;
  }
}
