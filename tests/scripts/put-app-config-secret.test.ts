import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// track isolated fixtures
const temporaryDirectories: string[] = [];

// create one isolated script fixture
const createFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ferry-secret-update-"));
  temporaryDirectories.push(root);
  const bin = path.join(root, "bin");
  const current = path.join(root, "current.json");
  const override = path.join(root, "override.json");
  const written = path.join(root, "written.json");
  const writtenUri = path.join(root, "written-uri.txt");
  const calls = path.join(root, "calls.txt");

  // create the fake executable directory
  mkdirSync(bin);
  const fakeAws = path.join(bin, "aws");
  writeFileSync(
    fakeAws,
    `#!/usr/bin/env bash
set -euo pipefail

# record command shape only
printf '%s\\n' "$*" >> "\${FAKE_AWS_CALLS}"

# return the private current value
if [[ "$1 $2" == "secretsmanager get-secret-value" ]]; then
  cat "\${FAKE_AWS_CURRENT_SECRET}"
  exit 0
fi

# capture the private merged value
if [[ "$1 $2" == "secretsmanager put-secret-value" ]]; then
  secret_uri=""
  # parse the secret file argument
  while [[ $# -gt 0 ]]; do
    # capture only the file uri
    if [[ "$1" == "--secret-string" ]]; then
      secret_uri="\${2}"
      shift 2
      continue
    fi
    shift
  done
  printf '%s' "\${secret_uri}" > "\${FAKE_AWS_WRITTEN_URI}"
  cp "\${secret_uri#file://}" "\${FAKE_AWS_WRITTEN_SECRET}"
  printf '%s\\n' '{"ARN":"test-secret","VersionId":"test-version","VersionStages":["AWSCURRENT"]}'
  exit 0
fi

echo "unexpected aws command" >&2
exit 64
`
  );
  chmodSync(fakeAws, 0o700);

  return { bin, calls, current, override, root, written, writtenUri };
};

// remove isolated fixtures
afterEach(() => {
  // remove every fixture
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("put-app-config-secret", () => {
  // preserve untouched secret keys
  it("merges a partial override before updating Secrets Manager", () => {
    const fixture = createFixture();
    writeFileSync(
      fixture.current,
      JSON.stringify({
        AUTH0_CLIENT_ID: "preserved-client",
        FORECAST_DEMAND_SHOCK_MODE: "shadow",
        WSDOT_API_KEY: "preserved-private-key",
      })
    );
    writeFileSync(
      fixture.override,
      JSON.stringify({ FORECAST_DEMAND_SHOCK_MODE: "on" })
    );

    const result = spawnSync(
      "bash",
      [
        path.resolve("infra/aws/scripts/put-app-config-secret.sh"),
        "--secret-id",
        "test-secret",
        "--from-json",
        fixture.override,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CONFIRM_AWS_SECRET_UPDATE: "yes",
          FAKE_AWS_CALLS: fixture.calls,
          FAKE_AWS_CURRENT_SECRET: fixture.current,
          FAKE_AWS_WRITTEN_SECRET: fixture.written,
          FAKE_AWS_WRITTEN_URI: fixture.writtenUri,
          PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
        },
      }
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(fixture.written, "utf8"))).toEqual({
      AUTH0_CLIENT_ID: "preserved-client",
      FORECAST_DEMAND_SHOCK_MODE: "on",
      WSDOT_API_KEY: "preserved-private-key",
    });
    expect(readFileSync(fixture.calls, "utf8").trim().split("\n")).toEqual([
      "secretsmanager get-secret-value --secret-id test-secret --query SecretString --output text",
      expect.stringContaining(
        "secretsmanager put-secret-value --secret-id test-secret --secret-string file://"
      ),
    ]);
    const temporarySecret = readFileSync(fixture.writtenUri, "utf8").replace(
      "file://",
      ""
    );
    expect(existsSync(temporarySecret)).toBe(false);
    expect(result.stdout).not.toContain("preserved-private-key");
    expect(result.stderr).not.toContain("preserved-private-key");
  });
});
