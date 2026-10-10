import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertClientBudgets,
  DEFAULT_CLIENT_BUDGETS,
  summarizeClientAssets,
} from "../../scripts/assert-client-budgets.mjs";

const directories: string[] = [];
const fixture = (files: Record<string, number>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-budget-"));
  directories.push(directory);
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), Buffer.alloc(bytes));
  }
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

// retain stylesheet enforcement and informative javascript accounting
describe("client asset budgets", () => {
  // keep the existing stylesheet limit without javascript gates
  it("enforces only the existing CSS allocation", () => {
    expect(DEFAULT_CLIENT_BUDGETS).toEqual({
      cssBytes: 152_000,
    });
  });

  // cover the exact production deployment failure
  it("accepts production JavaScript that exceeded the removed byte limit", () => {
    const summary = {
      cssBytes: 151_075,
      javascriptBytes: 5_300_010,
      javascriptFiles: 143,
      largestJavascriptBytes: 1_838_229,
      optionalBillingJavascriptBytes: 840_269,
    };

    expect(() => assertClientBudgets(summary)).not.toThrow();
  });

  // remove byte, count, single-chunk and optional billing enforcement together
  it("does not reject growth beyond any former JavaScript limit", () => {
    const summary = {
      cssBytes: 152_000,
      javascriptBytes: 100_000_000,
      javascriptFiles: 1_000,
      largestJavascriptBytes: 10_000_000,
      optionalBillingJavascriptBytes: 10_000_000,
    };
    expect(() => assertClientBudgets(summary)).not.toThrow();
  });

  // continue reporting javascript sizes without applying limits
  it("summarizes and accepts a bounded fixture", () => {
    const summary = summarizeClientAssets(
      fixture({ "main.css": 20, "main.js": 100, "route.js": 50 })
    );
    expect(summary).toEqual({
      cssBytes: 20,
      javascriptBytes: 150,
      javascriptFiles: 2,
      largestJavascriptBytes: 100,
      optionalBillingJavascriptBytes: 0,
    });
    expect(() =>
      assertClientBudgets(summary, {
        cssBytes: 20,
      })
    ).not.toThrow();
  });

  // retain an inclusive css threshold and its actionable failure
  it("rejects only stylesheet growth beyond the CSS limit", () => {
    const summary = summarizeClientAssets(
      fixture({ "app.css": 152_000, "map.js": 101 })
    );
    expect(() => assertClientBudgets(summary)).not.toThrow();
    expect(() =>
      assertClientBudgets({ ...summary, cssBytes: 152_001 })
    ).toThrow(/cssBytes/);
  });

  // preserve separate optional billing measurements without enforcement
  it("reports optional RevenueCat billing separately from core code", () => {
    const summary = summarizeClientAssets(
      fixture({
        "main.js": 100,
        "revenuecat-web-billing.example.js": 80,
      })
    );

    expect(summary).toEqual({
      cssBytes: 0,
      javascriptBytes: 100,
      javascriptFiles: 2,
      largestJavascriptBytes: 100,
      optionalBillingJavascriptBytes: 80,
    });
  });
});
