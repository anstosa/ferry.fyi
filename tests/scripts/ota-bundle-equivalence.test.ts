import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "ferry-ota-equivalence-"));
const script = path.resolve(__dirname, "../../scripts/compare-ota-bundles.py");

describe("OTA bundle payload equivalence", () => {
  // build archives with controlled content and ZIP metadata
  beforeAll(() => {
    const fixture = spawnSync(
      "python3",
      [
        "-c",
        `import pathlib, sys, warnings, zipfile
warnings.simplefilter("ignore", UserWarning)
root = pathlib.Path(sys.argv[1])
# create controlled payload and metadata variants
for name, year, entries in [
    ("original", 2024, [("index.html", "same"), ("app.js", "navigation")]),
    ("retimestamped", 2025, [("app.js", "navigation"), ("index.html", "same")]),
    ("changed", 2025, [("index.html", "same"), ("app.js", "changed config")]),
    ("renamed", 2025, [("index.html", "same"), ("other.js", "navigation")]),
    ("duplicate", 2025, [("index.html", "same"), ("index.html", "same")]),
]:
    # close each fixture before comparison
    with zipfile.ZipFile(root / (name + ".zip"), "w") as archive:
        # use explicit member timestamps
        for filename, content in entries:
            archive.writestr(zipfile.ZipInfo(filename, (year, 1, 1, 0, 0, 0)), content)
`,
        directory,
      ],
      { encoding: "utf8" }
    );
    expect(fixture.status, fixture.stderr).toBe(0);
  });

  // remove only the isolated test archives
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  // ignore archive ordering and timestamps but never changed payloads or paths
  it.each([
    ["original", 0],
    ["retimestamped", 0],
    ["changed", 1],
    ["renamed", 1],
    ["duplicate", 1],
  ])("compares the %s archive safely", (name, status) => {
    const result = spawnSync(
      "python3",
      [
        script,
        path.join(directory, "original.zip"),
        path.join(directory, `${name}.zip`),
      ],
      { encoding: "utf8" }
    );

    expect(result.status, result.stderr).toBe(status);
  });
});
