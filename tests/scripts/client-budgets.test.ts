import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertClientBudgets,
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

describe("client asset budgets", () => {
  it("allows bounded production route chunk growth", () => {
    const files: Record<string, number> = {};
    // create the allowed route chunks
    for (let index = 0; index < 140; index += 1) {
      files[`route-${index}.js`] = 1;
    }
    const summary = summarizeClientAssets(fixture(files));

    expect(() => assertClientBudgets(summary)).not.toThrow();
    expect(() =>
      assertClientBudgets({ ...summary, javascriptFiles: 141 })
    ).toThrow(/javascriptFiles/);
  });

  it("summarizes and accepts a bounded fixture", () => {
    const summary = summarizeClientAssets(
      fixture({ "main.css": 20, "main.js": 100, "route.js": 50 })
    );
    expect(summary).toEqual({
      cssBytes: 20,
      javascriptBytes: 150,
      javascriptFiles: 2,
      largestJavascriptBytes: 100,
    });
    expect(() =>
      assertClientBudgets(summary, {
        cssBytes: 20,
        javascriptBytes: 150,
        javascriptFiles: 2,
        largestJavascriptBytes: 100,
      })
    ).not.toThrow();
  });

  it("fails with the exact exceeded dimension", () => {
    const summary = summarizeClientAssets(fixture({ "map.js": 101 }));
    expect(() =>
      assertClientBudgets(summary, {
        cssBytes: 0,
        javascriptBytes: 100,
        javascriptFiles: 1,
        largestJavascriptBytes: 100,
      })
    ).toThrow(/javascriptBytes.*largestJavascriptBytes/s);
  });
});
