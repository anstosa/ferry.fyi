#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  wilsonLower95,
  wilsonLowerBound95,
} from "./summarize-automatic-checkin-evidence.mjs";

const SCHEMA_VERSION = 1;
const RELEASE = /^[0-9a-f]{7,12}$/;
const DETECTORS = new Set(["terminal", "vessel"]);
const ROOT_KEYS = new Set(["calculations", "release", "schemaVersion"]);
const CALCULATION_KEYS = new Set([
  "designSuccessProbabilityPermille",
  "desiredPowerPermille",
  "detector",
  "maximumAttempts",
  "reliabilityTargetPermille",
]);

// identify one plain json object
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// require one exact reviewed object shape
const requireExactKeys = (value, allowed) => {
  // reject arrays and nonobjects
  if (!isObject(value)) {
    throw new Error("invalid R1 power plan");
  }
  const keys = Object.keys(value);
  // reject missing or unknown fields
  if (keys.length !== allowed.size || !keys.every((key) => allowed.has(key))) {
    throw new Error("invalid R1 power plan");
  }
};

// require one bounded integer
const requireInteger = (value, minimum, maximum) => {
  // reject fractional or out-of-range assumptions
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("invalid R1 power plan");
  }
  return value;
};

// convert one explicit permille assumption
const probabilityFromPermille = (value, minimum = 1, maximum = 999) =>
  requireInteger(value, minimum, maximum) / 1000;

// round stable report values
const rounded = (value) => Number(value.toFixed(6));

// precompute one log-factorial table
const buildLogFactorials = (maximum) => {
  const values = new Array(maximum + 1).fill(0);
  // accumulate each factorial once
  for (let value = 2; value <= maximum; value += 1) {
    values[value] = values[value - 1] + Math.log(value);
  }
  return values;
};

// calculate one exact binomial upper tail
export const binomialUpperTail = (
  attempts,
  minimumSuccesses,
  probability,
  logFactorials = buildLogFactorials(attempts)
) => {
  requireInteger(attempts, 1, 5000);
  requireInteger(minimumSuccesses, 0, attempts);
  // handle the complete tail directly
  if (minimumSuccesses === 0) {
    return 1;
  }
  // handle a certain-success design directly
  if (probability === 1) {
    return 1;
  }
  // reject invalid design probabilities
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error("invalid R1 power plan");
  }
  let maximumLogProbability = Number.NEGATIVE_INFINITY;
  let scaledSum = 0;
  // sum the exact tail with online log scaling
  for (
    let successes = minimumSuccesses;
    successes <= attempts;
    successes += 1
  ) {
    const logProbability =
      logFactorials[attempts] -
      logFactorials[successes] -
      logFactorials[attempts - successes] +
      successes * Math.log(probability) +
      (attempts - successes) * Math.log1p(-probability);
    // rescale when a larger probability appears
    if (logProbability > maximumLogProbability) {
      scaledSum =
        scaledSum * Math.exp(maximumLogProbability - logProbability) + 1;
      maximumLogProbability = logProbability;
    } else {
      scaledSum += Math.exp(logProbability - maximumLogProbability);
    }
  }
  return Math.min(1, Math.exp(maximumLogProbability) * scaledSum);
};

// find the successes required by one Wilson lower-bound gate
export const requiredSuccessesForWilsonGate = (attempts, target) => {
  requireInteger(attempts, 1, 5000);
  // reject invalid reliability targets
  if (!Number.isFinite(target) || target <= 0 || target >= 1) {
    throw new Error("invalid R1 power plan");
  }
  // reject attempts that cannot meet the target even with no failures
  if (wilsonLowerBound95(attempts, attempts) < target) {
    return null;
  }
  let lower = 0;
  let upper = attempts;
  // find the first qualifying success count
  while (lower < upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    // retain only the half containing the first qualifying count
    if (wilsonLowerBound95(midpoint, attempts) >= target) {
      upper = midpoint;
    } else {
      lower = midpoint + 1;
    }
  }
  return lower;
};

// plan one detector's prospective sample size
const planCalculation = (calculation) => {
  requireExactKeys(calculation, CALCULATION_KEYS);
  const detector = calculation.detector;
  // reject free-text detector labels
  if (typeof detector !== "string" || !DETECTORS.has(detector)) {
    throw new Error("invalid R1 power plan");
  }
  const reliabilityTarget = probabilityFromPermille(
    calculation.reliabilityTargetPermille
  );
  const designSuccessProbability = probabilityFromPermille(
    calculation.designSuccessProbabilityPermille,
    1,
    1000
  );
  const desiredPower = probabilityFromPermille(
    calculation.desiredPowerPermille
  );
  const maximumAttempts = requireInteger(calculation.maximumAttempts, 1, 5000);
  // require a design alternative above the release target
  if (designSuccessProbability <= reliabilityTarget) {
    throw new Error("invalid R1 power plan");
  }
  const logFactorials = buildLogFactorials(maximumAttempts);
  let previousPower = 0;
  // find the first sample size whose exact power meets the requested bound
  for (let attempts = 1; attempts <= maximumAttempts; attempts += 1) {
    const requiredSuccesses = requiredSuccessesForWilsonGate(
      attempts,
      reliabilityTarget
    );
    // skip sample sizes that cannot attain the Wilson target
    if (requiredSuccesses === null) {
      previousPower = 0;
      continue;
    }
    const achievedPower = binomialUpperTail(
      attempts,
      requiredSuccesses,
      designSuccessProbability,
      logFactorials
    );
    // return only the first qualifying sample size
    if (achievedPower >= desiredPower) {
      return {
        achievedPower: rounded(achievedPower),
        analysisMethod: "exact-binomial-power-for-one-sided-wilson-lower-bound",
        calculationStatus: "calculated",
        designSuccessProbability,
        desiredPower,
        detector,
        maximumAttempts,
        minimumAttempts: attempts,
        previousAttemptPower: rounded(previousPower),
        reliabilityTarget,
        requiredSuccesses,
        successLowerConfidenceBound95: wilsonLower95(
          requiredSuccesses,
          attempts
        ),
      };
    }
    previousPower = achievedPower;
  }
  return {
    analysisMethod: "exact-binomial-power-for-one-sided-wilson-lower-bound",
    calculationStatus: "unresolved-within-maximum",
    designSuccessProbability,
    desiredPower,
    detector,
    maximumAttempts,
    minimumAttempts: null,
    reliabilityTarget,
    requiredSuccesses: null,
  };
};

// create one draft-only R1 power plan
export const planAutomaticCheckinR1 = (input) => {
  requireExactKeys(input, ROOT_KEYS);
  // require the frozen planner schema and exact short source hash
  if (
    input.schemaVersion !== SCHEMA_VERSION ||
    typeof input.release !== "string" ||
    !RELEASE.test(input.release) ||
    !Array.isArray(input.calculations) ||
    input.calculations.length !== DETECTORS.size
  ) {
    throw new Error("invalid R1 power plan");
  }
  // calculate each detector independently
  const calculations = input.calculations.map(planCalculation);
  // identify the exact detector coverage
  const detectors = calculations.map((calculation) => calculation.detector);
  // require one calculation for each detector
  if (
    new Set(detectors).size !== DETECTORS.size ||
    ![...DETECTORS].every((detector) => detectors.includes(detector))
  ) {
    throw new Error("invalid R1 power plan");
  }
  // stabilize detector ordering
  const orderedCalculations = calculations.sort((left, right) =>
    left.detector.localeCompare(right.detector)
  );
  return {
    calculations: orderedCalculations,
    release: input.release,
    schemaVersion: SCHEMA_VERSION,
    status: "draft-requires-independent-reviewed-amendment",
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

// write one immutable draft plan
const run = () => {
  const paths = parseArguments(process.argv.slice(2));
  const input = JSON.parse(fs.readFileSync(paths.input, "utf8"));
  const plan = planAutomaticCheckinR1(input);
  fs.writeFileSync(paths.output, `${JSON.stringify(plan, null, 2)}\n`, {
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
    process.stderr.write("automatic check-in R1 power plan rejected\n");
    process.exitCode = 1;
  }
}
