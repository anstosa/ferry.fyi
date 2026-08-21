import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import {
  summarizeAutomaticCheckinEvidence,
  summarizeBattery,
  wilson95,
  wilsonLower95,
} from "../../scripts/summarize-automatic-checkin-evidence.mjs";

// build one complete aggregate-only cell
const cell = () => ({
  accuracyBuckets: { "under-25m": 5 },
  artifactLinks: ["https://example.test/evidence/android-v0"],
  attempts: 5,
  batteryControls: {
    energyDiagnostic: "android-batterystats",
    networkState: "wifi",
    randomizedOrder: true,
    screenState: "off",
    thermalState: "nominal",
  },
  batteryDeltasPercentagePoints: [0, 0.2, 0.1],
  delayBuckets: { "under-1m": 5 },
  detector: "vessel",
  deviceClass: "pixel",
  duplicateCredits: 0,
  expiredCredits: 0,
  failureOutcomes: {},
  falseCredits: 0,
  gate: "v0",
  invariantBreaches: 0,
  lifecycle: "screen-off",
  osClass: "android-api35",
  osReleaseChannel: "stable",
  outcomeBuckets: { diagnostic_candidate_wiped: 5 },
  platform: "android",
  privacyResult: "pass",
  scenario: "battery-ferry-leg",
  successes: 5,
});

// build one complete evidence bundle
const bundle = () => ({
  build: {
    configGeneration: 1,
    localWorkCohort: "cohort-a",
    release: "9354363b",
    serverPolicyGeneration: 0,
    version: "3.5",
  },
  cells: [cell()],
  schemaVersion: 1,
});

// run one isolated cli probe
const runCli = (input: string, output: string) =>
  spawnSync(
    process.execPath,
    [
      path.resolve(
        __dirname,
        "../../scripts/summarize-automatic-checkin-evidence.mjs"
      ),
      "--input",
      input,
      "--output",
      output,
    ],
    { encoding: "utf8" }
  );

// group strict report behavior
describe("automatic check-in evidence summary", () => {
  // prove clean characterization math
  it("reports per-stratum Wilson and paired-battery confidence bounds", () => {
    const summary = summarizeAutomaticCheckinEvidence(bundle());

    expect(summary).toMatchObject({
      releaseGate: "not-assessed-requires-reviewed-r1-amendment",
      stopRuleTriggered: false,
    });
    expect(summary.cells[0]).toMatchObject({
      attempts: 5,
      battery: {
        meanPercentagePoints: 0.1,
        medianPercentagePoints: 0.1,
        pairs: 3,
        protocol: "paired-randomized",
        upperConfidenceBound95PercentagePoints: 0.268586,
      },
      successInterval95: {
        lower: 0.565518,
        method: "wilson-two-sided-95",
        upper: 1,
      },
      successLowerConfidenceBound95: {
        lower: 0.648883,
        method: "wilson-one-sided-lower-95",
      },
      successOutcomes: { diagnostic_candidate_wiped: 5 },
      provisionalCharacterization: "observed-not-release-approved",
      successes: 5,
    });
  });

  // prove zero-tolerance blocking
  it("triggers the stop rule without converting characterization into approval", () => {
    const input = bundle();
    input.cells[0].falseCredits = 1;
    input.cells[0].privacyResult = "fail";

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.stopRuleTriggered).toBe(true);
    expect(summary.releaseGate).toBe("blocked-stop-rule");
  });

  // prove private-field rejection
  it.each([
    ["candidate fields", { candidateId: "private" }],
    ["coordinates", { latitude: 47.1 }],
    ["routes", { route: "private" }],
    ["raw local generations", { localWorkGeneration: 4 }],
  ])("rejects unreviewed %s", (_label, privateField) => {
    const input = bundle();
    Object.assign(input.cells[0], privateField);

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove attempt reconciliation
  it("rejects bucket totals that could hide missing attempts", () => {
    const input = bundle();
    input.cells[0].delayBuckets = { "under-1m": 4 };

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove claimed failures belong to recorded outcomes
  it("rejects failure buckets absent from the complete outcome accounting", () => {
    const input = bundle();
    input.cells[0].successes = 4;
    input.cells[0].failureOutcomes = { location_unavailable: 1 };

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove mixed results derive exact successes
  it("derives successful outcomes after subtracting fixed failures", () => {
    const input = bundle();
    input.cells[0].successes = 4;
    input.cells[0].failureOutcomes = { location_unavailable: 1 };
    input.cells[0].outcomeBuckets = {
      diagnostic_candidate_wiped: 4,
      location_unavailable: 1,
    };

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells[0].successOutcomes).toEqual({
      diagnostic_candidate_wiped: 4,
    });
  });

  // prove strata remain separate
  it("rejects duplicate strata rather than pooling materially different runs", () => {
    const input = bundle();
    input.cells.push(cell());

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove scenarios remain separate
  it("keeps distinct scenarios in separate evidence cells", () => {
    const input = bundle();
    const second = cell();
    second.scenario = "battery-stationary";
    input.cells.push(second);

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells.map((entry) => entry.scenario)).toEqual([
      "battery-ferry-leg",
      "battery-stationary",
    ]);
  });

  // prove feasibility gates remain detector-specific
  it.each([
    ["terminal evidence in V0", "terminal", "v0"],
    ["vessel evidence in T0", "vessel", "t0"],
  ])("rejects %s", (_label, detector, gate) => {
    const input = bundle();
    input.cells[0].detector = detector;
    input.cells[0].gate = gate;

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove supporting runs cannot resemble physical evidence
  it("labels simulator evidence as supporting only", () => {
    const input = bundle();
    input.cells[0].platform = "ios";
    input.cells[0].osClass = "ios-26";
    input.cells[0].deviceClass = "ios-simulator";
    input.cells[0].osReleaseChannel = "stable";
    input.cells[0].batteryControls.energyDiagnostic = "xcode-energy-log";

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells[0]).toMatchObject({
      evidenceClass: "simulator-supporting",
      provisionalCharacterization: "supporting-only-not-physical",
    });
  });

  // prove preview hardware remains supporting evidence
  it("does not classify physical beta OS evidence as stable physical evidence", () => {
    const input = bundle();
    input.cells[0].platform = "ios";
    input.cells[0].osClass = "ios-27";
    input.cells[0].osReleaseChannel = "beta";
    input.cells[0].deviceClass = "iphone";
    input.cells[0].batteryControls.energyDiagnostic = "xcode-energy-log";

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells[0]).toMatchObject({
      evidenceClass: "beta-supporting",
      provisionalCharacterization: "supporting-only-not-physical",
    });
  });

  // prove Android evidence stays on stable platform releases
  it("rejects beta labels for stable Android API classes", () => {
    const input = bundle();
    input.cells[0].osReleaseChannel = "beta";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove the current iOS preview cannot be relabeled stable
  it("rejects stable labels for the reviewed iOS preview", () => {
    const input = bundle();
    input.cells[0].platform = "ios";
    input.cells[0].osClass = "ios-27";
    input.cells[0].osReleaseChannel = "stable";
    input.cells[0].deviceClass = "iphone";
    input.cells[0].batteryControls.energyDiagnostic = "xcode-energy-log";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove battery evidence is explicitly controlled
  it("rejects battery samples outside a fixed battery scenario", () => {
    const input = bundle();
    input.cells[0].scenario = "vessel-diagnostic";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove nonbattery cells remain battery-free
  it("accepts nonbattery scenarios only without battery controls or samples", () => {
    const input = bundle();
    input.cells[0].scenario = "vessel-diagnostic";
    input.cells[0].batteryControls = null;
    input.cells[0].batteryDeltasPercentagePoints = null;

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells[0].battery).toBeNull();
  });

  // prove control receipts cannot float free of measurements
  it("rejects battery controls without paired measurements", () => {
    const input = bundle();
    input.cells[0].batteryDeltasPercentagePoints = null;

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove randomization status remains truthful
  it("marks nonrandomized paired runs as protocol failures", () => {
    const input = bundle();
    input.cells[0].batteryControls.randomizedOrder = false;

    const summary = summarizeAutomaticCheckinEvidence(input);

    expect(summary.cells[0].battery.protocol).toBe("failed-not-randomized");
    expect(summary.cells[0].provisionalCharacterization).toBe(
      "insufficient-or-failed"
    );
  });

  // prove scenario labels remain fixed
  it("rejects free-text evidence scenarios", () => {
    const input = bundle();
    input.cells[0].scenario = "terminal-47.1-private";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove raw generation rejection
  it("rejects raw numeric local-work generations disguised as cohorts", () => {
    const input = bundle();
    input.build.localWorkCohort = "1234";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove identity-label rejection
  it("rejects identity-shaped cohort labels", () => {
    const input = bundle();
    input.build.localWorkCohort = "auth0-rider";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove exact build identity
  it.each([
    ["raw identity releases", { release: "auth0-rider" }],
    ["non-version labels", { version: "private-build" }],
  ])("rejects %s", (_label, buildField) => {
    const input = bundle();
    Object.assign(input.build, buildField);

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove platform binding
  it("rejects cross-platform relabeling", () => {
    const input = bundle();
    input.cells[0].osClass = "ios-15";

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove link-data rejection
  it("rejects artifact links with query or fragment data", () => {
    const input = bundle();
    input.cells[0].artifactLinks = [
      "https://example.test/evidence?candidate=private",
    ];

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove evidence completeness
  it("rejects empty reports and missing artifact receipts", () => {
    const empty = bundle();
    empty.cells = [];
    const missingArtifact = bundle();
    missingArtifact.cells[0].artifactLinks = [];

    // invoke both strict boundaries
    expect(() => summarizeAutomaticCheckinEvidence(empty)).toThrow(
      "invalid evidence schema"
    );
    expect(() => summarizeAutomaticCheckinEvidence(missingArtifact)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove generation bounds
  it("enforces shared uint32 generation bounds", () => {
    const input = bundle();
    input.build.configGeneration = 0x1_0000_0000;

    // invoke the strict boundary
    expect(() => summarizeAutomaticCheckinEvidence(input)).toThrow(
      "invalid evidence schema"
    );
  });

  // prove cli failures remain detail-free and immutable
  it("does not echo invalid input or replace an existing receipt", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "automatic-checkin-evidence-")
    );
    const invalidInput = path.join(directory, "invalid.json");
    const validInput = path.join(directory, "valid.json");
    const output = path.join(directory, "summary.json");
    // contain the isolated cli artifacts
    try {
      fs.writeFileSync(invalidInput, '{"candidateId":"private-canary"');

      const invalid = runCli(invalidInput, output);

      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("automatic check-in evidence rejected");
      expect(invalid.stderr).not.toContain("private-canary");
      expect(fs.existsSync(output)).toBe(false);

      fs.writeFileSync(validInput, JSON.stringify(bundle()));
      fs.writeFileSync(output, "retained receipt\n");

      const replacement = runCli(validInput, output);

      expect(replacement.status).toBe(1);
      expect(fs.readFileSync(output, "utf8")).toBe("retained receipt\n");
    } finally {
      // remove isolated cli artifacts
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });
});

// group bounded statistics
describe("automatic evidence statistics", () => {
  // prove extreme intervals
  it("calculates finite Wilson bounds at both extremes", () => {
    expect(wilson95(0, 5)).toEqual({
      lower: 0,
      method: "wilson-two-sided-95",
      upper: 0.434482,
    });
    expect(wilson95(5, 5).lower).toBe(0.565518);
    expect(wilsonLower95(0, 5)).toEqual({
      lower: 0,
      method: "wilson-one-sided-lower-95",
    });
    expect(wilsonLower95(5, 5).lower).toBe(0.648883);
  });

  // prove paired-run minimum
  it("requires at least three paired battery samples", () => {
    // invoke the strict boundary
    expect(() => summarizeBattery([0.1, 0.2])).toThrow(
      "invalid evidence schema"
    );
  });

  // prove finite-sample correction beyond the fixed table
  it("does not substitute the normal bound immediately above thirty pairs", () => {
    const samples = Array.from({ length: 31 }, (_value, index) => index % 2);
    const summary = summarizeBattery(samples);
    const mean =
      samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance = samples.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    );
    const standardError = Math.sqrt(
      variance / (samples.length - 1) / samples.length
    );
    const normalUpper = mean + 1.6448536269514722 * standardError;

    expect(summary.upperConfidenceBound95PercentagePoints).toBeGreaterThan(
      normalUpper
    );
  });
});
