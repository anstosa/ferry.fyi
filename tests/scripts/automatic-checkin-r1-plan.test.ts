import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  binomialUpperTail,
  planAutomaticCheckinR1,
  requiredSuccessesForWilsonGate,
} from "../../scripts/plan-automatic-checkin-r1.mjs";

// build one complete draft power-plan input
const input = () => ({
  calculations: [
    {
      designSuccessProbabilityPermille: 900,
      desiredPowerPermille: 800,
      detector: "terminal",
      maximumAttempts: 500,
      reliabilityTargetPermille: 800,
    },
    {
      designSuccessProbabilityPermille: 850,
      desiredPowerPermille: 800,
      detector: "vessel",
      maximumAttempts: 500,
      reliabilityTargetPermille: 700,
    },
  ],
  release: "9354363b",
  schemaVersion: 1,
});

// run one isolated planner cli probe
const runCli = (source: string, output: string) =>
  spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../../scripts/plan-automatic-checkin-r1.mjs"),
      "--input",
      source,
      "--output",
      output,
    ],
    { encoding: "utf8" }
  );

// group exact prospective calculations
describe("automatic check-in R1 power plan", () => {
  // prove draft status and minimum sample sizes
  it("calculates the first qualifying exact-binomial sample size", () => {
    const plan = planAutomaticCheckinR1(input());

    expect(plan.status).toBe("draft-requires-independent-reviewed-amendment");
    expect(
      plan.calculations.map((calculation) => calculation.detector)
    ).toEqual(["terminal", "vessel"]);
    // verify each prospective bound
    for (const calculation of plan.calculations) {
      expect(calculation.calculationStatus).toBe("calculated");
      expect(calculation.minimumAttempts).toBeGreaterThan(0);
      expect(calculation.requiredSuccesses).toBeGreaterThan(0);
      expect(calculation.achievedPower).toBeGreaterThanOrEqual(
        calculation.desiredPower
      );
      expect(calculation.previousAttemptPower).toBeLessThan(
        calculation.desiredPower
      );
      expect(
        calculation.successLowerConfidenceBound95.lower
      ).toBeGreaterThanOrEqual(calculation.reliabilityTarget);
    }
  });

  // prove known exact binomial tails
  it("calculates exact small binomial tails", () => {
    expect(binomialUpperTail(1, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(binomialUpperTail(2, 2, 0.5)).toBeCloseTo(0.25, 12);
    expect(binomialUpperTail(2, 1, 0.5)).toBeCloseTo(0.75, 12);
    expect(binomialUpperTail(2, 2, 1)).toBe(1);
  });

  // prove the planner does not invent product power floors
  it("accepts mathematically valid low power and certain design assumptions", () => {
    const planInput = input();
    planInput.calculations[0].designSuccessProbabilityPermille = 1000;
    planInput.calculations[0].desiredPowerPermille = 1;

    const plan = planAutomaticCheckinR1(planInput);

    expect(plan.calculations[0]).toMatchObject({
      calculationStatus: "calculated",
      designSuccessProbability: 1,
      desiredPower: 0.001,
    });
  });

  // prove Wilson threshold monotonicity
  it("finds the first success count meeting a Wilson target", () => {
    expect(requiredSuccessesForWilsonGate(5, 0.5)).toBe(5);
    expect(requiredSuccessesForWilsonGate(1, 0.99)).toBeNull();
  });

  // reject display-rounded threshold matches
  it("uses the unrounded Wilson bound for minimum sample sizes", () => {
    const planInput = input();
    planInput.calculations[0] = {
      designSuccessProbabilityPermille: 316,
      desiredPowerPermille: 500,
      detector: "terminal",
      maximumAttempts: 100,
      reliabilityTargetPermille: 239,
    };

    const plan = planAutomaticCheckinR1(planInput);
    const terminal = plan.calculations.find(
      (calculation) => calculation.detector === "terminal"
    );

    expect(requiredSuccessesForWilsonGate(75, 0.239)).toBe(25);
    expect(terminal).toMatchObject({
      minimumAttempts: 78,
      requiredSuccesses: 25,
    });
  });

  // prove impossible bounded plans remain unresolved
  it("reports unresolved instead of weakening the requested gate", () => {
    const planInput = input();
    planInput.calculations[0] = {
      designSuccessProbabilityPermille: 999,
      desiredPowerPermille: 990,
      detector: "terminal",
      maximumAttempts: 1,
      reliabilityTargetPermille: 990,
    };

    const plan = planAutomaticCheckinR1(planInput);

    expect(plan.calculations[0]).toMatchObject({
      calculationStatus: "unresolved-within-maximum",
      detector: "terminal",
      minimumAttempts: null,
      requiredSuccesses: null,
    });
  });

  // prove target assumptions remain coherent
  it("rejects design probabilities that do not exceed the target", () => {
    const planInput = input();
    planInput.calculations[0].designSuccessProbabilityPermille = 800;

    // invoke the strict boundary
    expect(() => planAutomaticCheckinR1(planInput)).toThrow(
      "invalid R1 power plan"
    );
  });

  // prove both detectors remain mandatory and unique
  it("rejects duplicate detector calculations", () => {
    const planInput = input();
    planInput.calculations[1].detector = "terminal";

    // invoke the strict boundary
    expect(() => planAutomaticCheckinR1(planInput)).toThrow(
      "invalid R1 power plan"
    );
  });

  // prove cli failures remain detail-free and immutable
  it("does not echo invalid input or replace an existing plan", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "automatic-checkin-r1-plan-")
    );
    const invalidInput = path.join(directory, "invalid.json");
    const validInput = path.join(directory, "valid.json");
    const output = path.join(directory, "plan.json");
    // contain the isolated cli artifacts
    try {
      fs.writeFileSync(invalidInput, '{"subject":"private-canary"}');

      const invalid = runCli(invalidInput, output);

      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain(
        "automatic check-in R1 power plan rejected"
      );
      expect(invalid.stderr).not.toContain("private-canary");
      expect(fs.existsSync(output)).toBe(false);

      fs.writeFileSync(validInput, JSON.stringify(input()));
      fs.writeFileSync(output, "retained plan\n");

      const replacement = runCli(validInput, output);

      expect(replacement.status).toBe(1);
      expect(fs.readFileSync(output, "utf8")).toBe("retained plan\n");
    } finally {
      // remove isolated cli artifacts
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  // prove named imports do not require a cli path
  it("loads both evidence modules without an entrypoint argument", () => {
    const moduleUrls = [
      "../../scripts/summarize-automatic-checkin-evidence.mjs",
      "../../scripts/plan-automatic-checkin-r1.mjs",
    ].map(
      (modulePath) => pathToFileURL(path.resolve(__dirname, modulePath)).href
    );

    // import each reusable module in an eval process
    for (const moduleUrl of moduleUrls) {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(moduleUrl)})`,
        ],
        { encoding: "utf8" }
      );

      expect(result.status).toBe(0);
    }
  });
});
