import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateFillTimingCases,
  type FillTimingEvaluationCase,
} from "~/lib/capacityObservationsEvaluation";

const defaultFixture = path.resolve(
  __dirname,
  "../../tests/fixtures/fill-timing-backtest.json"
);

// load fixture-only causal cases without rider data
const loadCases = async (
  fixturePath: string
): Promise<FillTimingEvaluationCase[]> => {
  const contents = await readFile(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(contents);
  // require a bounded fixture array
  if (!Array.isArray(parsed) || parsed.length > 10_000) {
    throw new Error(
      "Fill timing fixture must be an array of at most 10000 cases"
    );
  }
  return parsed as FillTimingEvaluationCase[];
};

// run the deterministic fixture backtest
const main = async (): Promise<void> => {
  const fixturePath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : defaultFixture;
  const cases = await loadCases(fixturePath);
  const report = evaluateFillTimingCases(cases);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Fill timing backtest failed"}\n`
  );
  process.exitCode = 1;
});
