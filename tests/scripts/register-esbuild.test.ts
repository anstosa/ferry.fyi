import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("register-esbuild", () => {
  it("resolves deferred server imports through TypeScript path aliases", () => {
    const repositoryRoot = process.cwd();
    const output = execFileSync(
      process.execPath,
      [
        "../scripts/register-esbuild.js",
        "../tests/fixtures/register-esbuild-dynamic-import.ts",
      ],
      {
        cwd: path.join(repositoryRoot, "server"),
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "test" },
      }
    );

    expect(output).toBe("dynamic-alias-ok");
  });
});
