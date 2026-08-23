#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_CLIENT_BUDGETS = Object.freeze({
  cssBytes: 140_000,
  javascriptBytes: 5_200_000,
  // reserve bounded route-chunk headroom
  javascriptFiles: 140,
  largestJavascriptBytes: 1_900_000,
  optionalBillingJavascriptBytes: 900_000,
});

export const summarizeClientAssets = (directory) => {
  if (!fs.existsSync(directory)) {
    throw new Error(`Client asset directory is missing: ${directory}`);
  }
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      bytes: fs.statSync(path.join(directory, entry.name)).size,
      name: entry.name,
    }));
  const javascript = entries.filter(({ name }) => name.endsWith(".js"));
  const optionalBillingJavascript = javascript.filter(({ name }) =>
    name.startsWith("revenuecat-web-billing.")
  );
  const coreJavascript = javascript.filter(
    ({ name }) => !name.startsWith("revenuecat-web-billing.")
  );
  const css = entries.filter(({ name }) => name.endsWith(".css"));
  return {
    cssBytes: css.reduce((total, entry) => total + entry.bytes, 0),
    javascriptBytes: coreJavascript.reduce(
      (total, entry) => total + entry.bytes,
      0
    ),
    javascriptFiles: javascript.length,
    largestJavascriptBytes: Math.max(
      0,
      ...javascript.map(({ bytes }) => bytes)
    ),
    optionalBillingJavascriptBytes: optionalBillingJavascript.reduce(
      (total, entry) => total + entry.bytes,
      0
    ),
  };
};

export const assertClientBudgets = (
  summary,
  budgets = DEFAULT_CLIENT_BUDGETS
) => {
  const failures = Object.entries(budgets)
    .filter(([key, limit]) => summary[key] > limit)
    .map(
      ([key, limit]) =>
        `${key}: ${summary[key].toLocaleString()} exceeds ${limit.toLocaleString()}`
    );
  if (failures.length > 0) {
    throw new Error(`Client asset budget exceeded:\n${failures.join("\n")}`);
  }
  return summary;
};

// direct execution guard
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(
    process.cwd(),
    process.argv[2] ?? "dist/client/assets"
  );
  const summary = assertClientBudgets(summarizeClientAssets(directory));
  process.stdout.write(
    `${JSON.stringify({ budgets: DEFAULT_CLIENT_BUDGETS, summary }, null, 2)}\n`
  );
}
