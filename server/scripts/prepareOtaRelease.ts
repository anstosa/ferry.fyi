import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { OtaRelease } from "shared/contracts/ota";

import { isReleaseNewer, parseOtaReleaseIndex } from "../lib/ota";

// assign each source revision a stable bundle version without changing the native version
export const createOtaReleaseVersion = (
  packageVersion: string,
  sourceCount: number
): string => {
  const parts = packageVersion.split(".").map(Number);
  // reject noncanonical base versions and unsafe history counts
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(packageVersion) ||
    parts.some((part) => !Number.isSafeInteger(part)) ||
    !Number.isSafeInteger(sourceCount) ||
    sourceCount < 1 ||
    !Number.isSafeInteger(parts[2] + sourceCount)
  ) {
    throw new Error("Invalid OTA base version or source history count");
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + sourceCount}`;
};

// validate monotonic channel updates and preserve exact immutable retries
export const prepareOtaReleaseIndex = (
  current: unknown,
  candidate: unknown,
  sourceSha: string
): { releases: OtaRelease[] } => {
  const releases = parseOtaReleaseIndex(current);
  // reject corrupt existing records before changing any channel
  if (!releases) {
    throw new Error("Invalid OTA release index");
  }
  // require a complete source identifier for immutable bundle names
  if (!/^[a-f\d]{40}$/u.test(sourceSha)) {
    throw new Error("Invalid OTA source SHA");
  }
  const next = parseOtaReleaseIndex({ releases: [candidate] })?.[0];
  // validate the candidate before deriving its immutable key
  if (!next) {
    throw new Error("Invalid OTA release candidate");
  }
  const url = new URL(next.url);
  const filename = `ferry-fyi-${next.version}-${sourceSha}-${next.checksum}.zip`;
  // require version, source and checksum to match the published object path
  if (url.pathname !== `/bundles/${next.version}/${filename}`) {
    throw new Error("Invalid OTA release candidate object path");
  }
  const previous = releases.find(({ channel }) => channel === next.channel);
  // reuse only the exact immutable pointer after retry payload validation
  if (
    previous?.version === next.version &&
    previous.checksum === next.checksum &&
    previous.url ===
      `${url.origin}/bundles/${next.version}/ferry-fyi-${next.version}-${sourceSha}-${previous.checksum}.zip`
  ) {
    return { releases };
  }
  // refuse equal-version replacements and stale deployment downgrades
  if (previous && !isReleaseNewer(next.version, previous.version)) {
    throw new Error(
      "OTA release candidate must be newer than the channel version"
    );
  }
  return {
    releases: [
      ...releases.filter(({ channel }) => channel !== next.channel),
      next,
    ],
  };
};

// run publisher preparation through the repository's TypeScript wrapper
const run = (): void => {
  const mode = process.argv[3];
  // derive versions only from complete checkout history
  if (mode === "version") {
    const shallow = execFileSync(
      "git",
      ["rev-parse", "--is-shallow-repository"],
      {
        encoding: "utf8",
      }
    ).trim();
    // refuse unstable counts from shallow CI checkouts
    if (shallow !== "false") {
      throw new Error("OTA version generation requires complete git history");
    }
    const sourceCount = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], {
        encoding: "utf8",
      }).trim()
    );
    const { version } = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
    ) as { version: string };
    process.stdout.write(`${createOtaReleaseVersion(version, sourceCount)}\n`);
    return;
  }
  // validate and print the next release index without writing remote state
  if (mode === "index" && process.argv[4]) {
    const current: unknown = JSON.parse(readFileSync(process.argv[4], "utf8"));
    const next = prepareOtaReleaseIndex(
      current,
      {
        channel: process.env.OTA_CHANNEL,
        checksum: process.env.BUNDLE_CHECKSUM,
        url: process.env.BUNDLE_URL,
        version: process.env.RELEASE_VERSION,
      },
      process.env.GITHUB_SHA ?? ""
    );
    process.stdout.write(`${JSON.stringify(next)}\n`);
    return;
  }
  throw new Error("Expected OTA preparation mode: version or index <path>");
};

// avoid executing the CLI when imported by regression tests
if (process.argv[2] && path.resolve(process.argv[2]) === __filename) {
  run();
}
