#!/usr/bin/env node

import { chromium } from "@playwright/test";
import childProcess from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  categorizeRequest,
  createImmutableReceiptWriter,
  harnessModesForSeries,
  hashDirectory,
  hashFile,
  RUNTIME_BROWSER_CLOCK_SKEW,
  RUNTIME_BROWSER_DEADLINES,
  RUNTIME_BROWSER_SCHEMA_VERSION,
  sha256,
} from "./runtime-browser-performance-contract.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureCertificate = fs.readFileSync(
  path.join(repoRoot, "tests/e2e/certs/ferry-fyi.crt")
);
const canonicalSampling = Object.freeze({ measured: 7, series: 2, warmups: 2 });
const scenarios = Object.freeze([
  { id: "home", path: "/" },
  { id: "schedule", path: "/seattle/bainbridge" },
  { id: "tickets", path: "/tickets" },
  { id: "cameras", path: "/seattle/bainbridge/cameras" },
  { id: "map", path: "/seattle/bainbridge/map" },
]);
const devices = Object.freeze({
  desktop: { deviceScaleFactor: 1, height: 900, width: 1440 },
  mobile: {
    deviceScaleFactor: 3,
    hasTouch: true,
    height: 844,
    isMobile: true,
    width: 390,
  },
});
const performanceProfiles = Object.freeze({
  desktop: {
    cpuSlowdown: 1,
    downloadBytesPerSecond: 1_250_000,
    latencyMs: 40,
    uploadBytesPerSecond: 625_000,
  },
  mobile: {
    cpuSlowdown: 4,
    downloadBytesPerSecond: 200_000,
    latencyMs: 150,
    uploadBytesPerSecond: 93_750,
  },
});
const cacheStates = Object.freeze(["cold", "warm"]);
const help = `Usage:
  yarn benchmark:browser-runtime -- --baseline <git-ref> --candidate <git-ref> --receipt 0

Options:
  --baseline <ref>       Audited baseline git ref
  --candidate <ref>      Candidate git ref
  --receipt 0            Required receipt id
  --scenario <id>        Repeatable scenario filter
  --device <name>        mobile or desktop
  --cache <state>        cold or warm
  --warmups <count>      Default 2
  --samples <count>      Default 7
  --series <count>       Default 2
  --settle-ms <count>    Request window after navigation, default 10000
  --output <directory>   Artifact parent, default .omx/performance/runtime-browser
  --keep-worktrees       Retain temporary detached worktrees
`;

const fail = (message) => {
  throw new Error(`${message}\n\n${help}`);
};

const parseInteger = (value, name, { minimum = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) fail(`Invalid ${name}`);
  return parsed;
};

const parseArgs = (argv) => {
  const options = {
    cache: [],
    device: [],
    keepWorktrees: false,
    output: path.join(repoRoot, ".omx/performance/runtime-browser"),
    samples: canonicalSampling.measured,
    scenario: [],
    series: canonicalSampling.series,
    settleMs: 10_000,
    warmups: canonicalSampling.warmups,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(help);
      process.exit(0);
    }
    if (argument === "--keep-worktrees") {
      options.keepWorktrees = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${argument}`);
    index += 1;
    switch (argument) {
      case "--baseline":
        options.baseline = value;
        break;
      case "--candidate":
        options.candidate = value;
        break;
      case "--receipt":
        options.receipt = value;
        break;
      case "--scenario":
        options.scenario.push(value);
        break;
      case "--device":
        options.device.push(value);
        break;
      case "--cache":
        options.cache.push(value);
        break;
      case "--warmups":
        options.warmups = parseInteger(value, argument);
        break;
      case "--samples":
        options.samples = parseInteger(value, argument, { minimum: 1 });
        break;
      case "--series":
        options.series = parseInteger(value, argument, { minimum: 1 });
        break;
      case "--settle-ms":
        options.settleMs = parseInteger(value, argument, { minimum: 1_000 });
        break;
      case "--output":
        options.output = path.resolve(repoRoot, value);
        break;
      default:
        fail(`Unknown option: ${argument}`);
    }
  }
  if (!options.baseline || !options.candidate)
    fail("Baseline and candidate are required");
  if (options.receipt !== "0") fail("G001 supports only --receipt 0");
  const selectedScenarios = options.scenario.length
    ? scenarios.filter(({ id }) => options.scenario.includes(id))
    : scenarios;
  if (
    selectedScenarios.length !== (options.scenario.length || scenarios.length)
  ) {
    fail("Unknown scenario filter");
  }
  const selectedDevices = options.device.length
    ? options.device
    : Object.keys(devices);
  if (selectedDevices.some((name) => !devices[name]))
    fail("Unknown device filter");
  const selectedCaches = options.cache.length ? options.cache : cacheStates;
  if (selectedCaches.some((name) => !cacheStates.includes(name)))
    fail("Unknown cache filter");
  return { ...options, selectedCaches, selectedDevices, selectedScenarios };
};

const exec = (command, args, options = {}) =>
  childProcess.execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });

const resolveCommit = (reference) =>
  exec("git", ["rev-parse", "--verify", `${reference}^{commit}`], {
    capture: true,
  }).trim();

const combinedArtifactHash = (workspace) =>
  sha256(
    ["client", "ssr", "e2e"]
      .map(
        (name) =>
          `${name}:${hashDirectory(path.join(workspace, "dist", name), {
            exclude: (file) => file.endsWith(".map"),
          })}`
      )
      .join("\n")
  );

const manifestBaseline = (workspace) => {
  const manifestPath = path.join(workspace, "dist/client/.vite/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = Object.values(manifest);
  const imports = Object.entries(
    [...new Set(entries.map(({ file }) => file))].reduce((result, fileName) => {
      if (!fileName?.endsWith(".js")) return result;
      const category = categorizeRequest(
        `https://ferry.fyi/${fileName}`,
        "script"
      ).category;
      const file = path.join(workspace, "dist/client", fileName);
      const current = result[category] ?? { bytes: 0, count: 0 };
      current.bytes += fs.statSync(file).size;
      current.count += 1;
      result[category] = current;
      return result;
    }, {})
  )
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([category, values]) => ({
      category,
      decodedBytes: { unit: "bytes", value: values.bytes },
      files: { unit: "count", value: values.count },
    }));
  return {
    artifactHash: hashFile(manifestPath),
    chunks: { unit: "count", value: entries.length },
    dynamicImports: {
      unit: "count",
      value: entries.reduce(
        (count, entry) => count + (entry.dynamicImports?.length ?? 0),
        0
      ),
    },
    imports,
    staticImports: {
      unit: "count",
      value: entries.reduce(
        (count, entry) => count + (entry.imports?.length ?? 0),
        0
      ),
    },
  };
};

const prepareWorkspace = (commit) => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "ferry-runtime-benchmark-")
  );
  const workspace = path.join(temporaryRoot, "worktree");
  let worktreeAdded = false;
  try {
    exec("git", ["worktree", "add", "--detach", workspace, commit]);
    worktreeAdded = true;
    fs.symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(workspace, "node_modules"),
      "dir"
    );
    const buildEnvironment = {
      ...process.env,
      CACHE_NAME: "runtime-browser-benchmark",
      NODE_ENV: "production",
      // A benchmark build must never publish a release or source maps. The DSN
      // remains available to the built client so the artifact graph stays
      // production-representative; only the build-time upload credential is
      // removed.
      SENTRY_AUTH_TOKEN: "",
    };
    for (const script of ["build:client", "build:ssr", "build:e2e:ssr"]) {
      exec("yarn", [script], { cwd: workspace, env: buildEnvironment });
    }
    return {
      artifactHash: combinedArtifactHash(workspace),
      commit,
      manifest: manifestBaseline(workspace),
      temporaryRoot,
      workspace,
    };
  } catch (error) {
    if (worktreeAdded) {
      try {
        exec("git", ["worktree", "remove", "--force", workspace]);
      } catch {
        // Preserve the original build failure; prune handles stale metadata.
        try {
          exec("git", ["worktree", "prune"]);
        } catch {
          // The original build failure remains the actionable error.
        }
      }
    }
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
};

const removeWorkspace = (build) => {
  try {
    exec("git", ["worktree", "remove", "--force", build.workspace]);
  } finally {
    fs.rmSync(build.temporaryRoot, { force: true, recursive: true });
  }
};

const requestJson = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { ca: fixtureCertificate, method: options.method ?? "GET" },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Fixture request failed: ${response.statusCode}`));
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        });
      }
    );
    request.once("error", reject);
    request.end();
  });

const startFixture = async (build, port) => {
  const baseUrl = `https://ferry.fyi:${port}`;
  const child = childProcess.spawn(
    "node",
    ["dist/e2e/ssr-fixture-server.cjs"],
    {
      cwd: build.workspace,
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        NODE_ENV: "test",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Fixture exited early\n${output}`);
    try {
      await requestJson(`https://127.0.0.1:${port}/__fixture__/health`);
      return { baseUrl, child, port };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill("SIGTERM");
  throw new Error(`Fixture did not become ready\n${output}`);
};

const stopFixture = async (fixture) => {
  if (fixture.child.exitCode !== null) return;
  fixture.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => fixture.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (fixture.child.exitCode === null) fixture.child.kill("SIGKILL");
};

const observerScript = () => {
  const state = {
    cls: 0,
    fcp: null,
    freshness: [],
    longTasks: [],
    takeover: null,
  };
  Object.defineProperty(window, "__FERRY_FYI_RUNTIME_BENCHMARK__", {
    configurable: false,
    enumerable: false,
    value: state,
    writable: false,
  });
  const observe = (type, callback) => {
    try {
      new PerformanceObserver((list) =>
        list.getEntries().forEach(callback)
      ).observe({
        buffered: true,
        type,
      });
    } catch {
      // Unsupported metrics remain explicit nulls in the sample.
    }
  };
  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") state.fcp = entry.startTime;
  });
  observe("longtask", (entry) => state.longTasks.push(entry.duration));
  observe("layout-shift", (entry) => {
    if (!entry.hadRecentInput) state.cls += entry.value;
  });
  const captureSnapshot = () => {
    const script = document.querySelector("#ferry-fyi-public-ssr-snapshot");
    if (!script?.textContent) return;
    try {
      const snapshot = JSON.parse(script.textContent);
      state.freshness = Object.entries(snapshot.sources ?? {}).map(
        ([source, value]) => ({
          observedAt: value.observedAt ?? null,
          scheduleTimestampSeconds:
            source === "schedule" && Number.isFinite(value.value?.timestamp)
              ? value.value.timestamp
              : null,
          source,
          sourceUpdatedAt: value.sourceUpdatedAt ?? null,
        })
      );
    } catch {
      state.freshness = [];
    }
  };
  document.addEventListener("DOMContentLoaded", captureSnapshot, {
    once: true,
  });
  const takeover = new MutationObserver(() => {
    const root = document.querySelector("#root");
    if (root?.getAttribute("data-ferry-fyi-snapshot-consumed") === "true") {
      state.takeover ??= performance.now();
    }
  });
  takeover.observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  });
};

const safeNumber = (value) => (Number.isFinite(value) ? value : null);
const metric = (value, unit) => ({ unit, value: safeNumber(value) });
const ageFromEpochMilliseconds = (timestamp, now) => {
  if (!Number.isFinite(timestamp)) return null;
  const difference = now - timestamp;
  if (difference < -RUNTIME_BROWSER_CLOCK_SKEW.value) return null;
  return Math.max(0, difference);
};

const collectPageMetrics = (page, measurementWindowMs) =>
  page.evaluate((windowMs) => {
    const fallbackLongTasks = performance
      .getEntriesByType("longtask")
      .map((entry) => entry.duration);
    const fallbackShifts = performance
      .getEntriesByType("layout-shift")
      .filter((entry) => !entry.hadRecentInput);
    const state = window.__FERRY_FYI_RUNTIME_BENCHMARK__ ?? {
      cls: fallbackShifts.reduce((sum, entry) => sum + entry.value, 0),
      fcp:
        performance
          .getEntriesByType("paint")
          .find((entry) => entry.name === "first-contentful-paint")
          ?.startTime ?? null,
      freshness: [],
      longTasks: fallbackLongTasks,
      takeover: null,
    };
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      decodedBodySize: entry.decodedBodySize,
      encodedBodySize: entry.encodedBodySize,
      initiatorType: entry.initiatorType,
      name: entry.name,
      transferSize: entry.transferSize,
    }));
    return {
      freshness: state.freshness,
      metrics: {
        activationMs: state.takeover,
        cls: state.cls,
        decodedBytes: resources.reduce(
          (sum, entry) => sum + entry.decodedBodySize,
          0
        ),
        encodedBytes: resources.reduce(
          (sum, entry) => sum + entry.encodedBodySize,
          0
        ),
        fcpMs: state.fcp,
        firstFeedbackMs: null,
        jsDecodedBytes: resources
          .filter((entry) => entry.initiatorType === "script")
          .reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        jsRequests: resources.filter(
          (entry) => entry.initiatorType === "script"
        ).length,
        longTasksTotalMs: state.longTasks.reduce(
          (sum, duration) => sum + duration,
          0
        ),
        maxTaskMs: state.longTasks.length ? Math.max(...state.longTasks) : 0,
        resourceRequests: resources.length,
        takeoverMs: state.takeover,
        ttfbMs: navigation?.responseStart ?? null,
        transferBytes: resources.reduce(
          (sum, entry) => sum + entry.transferSize,
          0
        ),
        windowMs,
      },
      resources,
    };
  }, measurementWindowMs);

const sampleOnce = async ({
  browser,
  build,
  cacheState,
  deviceName,
  fixture,
  harnessMode,
  measured,
  sampleIndex,
  scenario,
  series,
  settleMs,
  target,
  warmContext,
}) => {
  const context =
    warmContext ??
    (await browser.newContext({
      ...devices[deviceName],
      ignoreHTTPSErrors: true,
      serviceWorkers: "allow",
      viewport: {
        height: devices[deviceName].height,
        width: devices[deviceName].width,
      },
    }));
  if (harnessMode === "observer") {
    await context.addInitScript(observerScript);
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const profile = performanceProfiles[deviceName];
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    connectionType: deviceName === "mobile" ? "cellular4g" : "wifi",
    downloadThroughput: profile.downloadBytesPerSecond,
    latency: profile.latencyMs,
    offline: false,
    uploadThroughput: profile.uploadBytesPerSecond,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: profile.cpuSlowdown,
  });
  const pendingRequests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("request", (request) => {
    pendingRequests.push({
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  const startedAt = new Date().toISOString();
  await page.goto(`${fixture.baseUrl}${scenario.path}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(Math.min(5_000, settleMs));
  const collected = await collectPageMetrics(page, Math.min(5_000, settleMs));
  if (settleMs > 5_000) await page.waitForTimeout(settleMs - 5_000);
  const fixtureState = await requestJson(
    `https://127.0.0.1:${fixture.port}/__fixture__/state`
  );
  const documentTelemetry = [...(fixtureState.telemetry ?? [])]
    .reverse()
    .find((event) => event.event === "ssr_document");
  const sampleId = [
    target,
    series,
    scenario.id,
    deviceName,
    cacheState,
    harnessMode,
    measured ? "measured" : "warmup",
    sampleIndex,
  ].join(":");
  const resourcesByUrl = new Map(
    collected.resources.map((entry) => [entry.name, entry])
  );
  const requestEvidence = pendingRequests.map(({ resourceType, url }) => {
    const resource = resourcesByUrl.get(url);
    return {
      ...categorizeRequest(url, resourceType),
      artifactHash: build.artifactHash,
      decodedBytes: metric(resource?.decodedBodySize ?? null, "bytes"),
      encodedBytes: metric(resource?.encodedBodySize ?? null, "bytes"),
      resourceType,
      sampleId,
      schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
      target,
      transferBytes: metric(resource?.transferSize ?? null, "bytes"),
    };
  });
  const sampledAt = Date.now();
  const sample = {
    artifactHash: build.artifactHash,
    commit: build.commit,
    errors: {
      count: metric(errors.length, "count"),
      names: [...new Set(errors)].sort(),
    },
    freshness: collected.freshness.map((freshness) => {
      const observedAt = Date.parse(freshness.observedAt);
      const sourceUpdatedAt = freshness.sourceUpdatedAt
        ? Date.parse(freshness.sourceUpdatedAt)
        : null;
      return {
        checkAge: metric(
          ageFromEpochMilliseconds(observedAt, sampledAt),
          "milliseconds"
        ),
        contentAge: metric(
          ageFromEpochMilliseconds(sourceUpdatedAt, sampledAt),
          "milliseconds"
        ),
        observedAt: metric(observedAt, "epoch-milliseconds"),
        scheduleTimestamp: metric(
          freshness.scheduleTimestampSeconds,
          "epoch-seconds"
        ),
        source: freshness.source,
        sourceUpdatedAt: metric(sourceUpdatedAt, "epoch-milliseconds"),
      };
    }),
    measured,
    metrics: {
      activation: metric(collected.metrics.activationMs, "milliseconds"),
      cls: metric(collected.metrics.cls, "score"),
      decodedBytes: metric(collected.metrics.decodedBytes, "bytes"),
      encodedBytes: metric(collected.metrics.encodedBytes, "bytes"),
      fcp: metric(collected.metrics.fcpMs, "milliseconds"),
      firstFeedback: metric(collected.metrics.firstFeedbackMs, "milliseconds"),
      jsDecodedBytes: metric(collected.metrics.jsDecodedBytes, "bytes"),
      jsRequests: metric(collected.metrics.jsRequests, "count"),
      longTasksTotal: metric(
        collected.metrics.longTasksTotalMs,
        "milliseconds"
      ),
      maxTask: metric(collected.metrics.maxTaskMs, "milliseconds"),
      resourceRequests: metric(collected.metrics.resourceRequests, "count"),
      takeover: metric(collected.metrics.takeoverMs, "milliseconds"),
      transferBytes: metric(collected.metrics.transferBytes, "bytes"),
      ttfb: metric(collected.metrics.ttfbMs, "milliseconds"),
      window: metric(collected.metrics.windowMs, "milliseconds"),
    },
    sampleId,
    sampleIndex,
    scenario: {
      cacheState,
      device: deviceName,
      harnessMode,
      id: scenario.id,
      path: scenario.path,
    },
    schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
    series,
    ssr: documentTelemetry
      ? {
          cacheOutcome: documentTelemetry.cacheOutcome ?? null,
          duration: metric(documentTelemetry.durationMs, "milliseconds"),
          phases: documentTelemetry.phases ?? null,
        }
      : null,
    startedAt,
    target,
  };
  await page.close();
  if (!warmContext) await context.close();
  return { requestEvidence, sample };
};

const quantile = (values, percentile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)
  ];
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const summarizeMetric = (samples, name, unit) => {
  const values = samples
    .map((sample) => sample.metrics[name]?.value)
    .filter((value) => Number.isFinite(value));
  return {
    median: metric(median(values), unit),
    p75: metric(quantile(values, 0.75), unit),
    worst: metric(values.length ? Math.max(...values) : null, unit),
  };
};

const bootstrapMedianDelta = (baseline, candidate, unit) => {
  if (!baseline.length || !candidate.length) {
    return {
      high: metric(null, unit),
      low: metric(null, unit),
      iterations: { unit: "count", value: 0 },
    };
  }
  let randomState = 0x5f3759df;
  const randomIndex = (length) => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState % length;
  };
  const deltas = [];
  const iterations = 2_000;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const baselineSample = Array.from(
      { length: baseline.length },
      () => baseline[randomIndex(baseline.length)]
    );
    const candidateSample = Array.from(
      { length: candidate.length },
      () => candidate[randomIndex(candidate.length)]
    );
    deltas.push(median(candidateSample) - median(baselineSample));
  }
  return {
    high: metric(quantile(deltas, 0.975), unit),
    low: metric(quantile(deltas, 0.025), unit),
    iterations: { unit: "count", value: iterations },
  };
};

const comparisonSummaries = (measured) => {
  const metricUnits = {
    activation: "milliseconds",
    cls: "score",
    fcp: "milliseconds",
    firstFeedback: "milliseconds",
    jsDecodedBytes: "bytes",
    longTasksTotal: "milliseconds",
    maxTask: "milliseconds",
    takeover: "milliseconds",
    ttfb: "milliseconds",
  };
  const keys = [
    ...new Set(
      measured.map((sample) =>
        [
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":")
      )
    ),
  ];
  return keys.map((key) => {
    const group = measured.filter(
      (sample) =>
        [
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":") === key
    );
    return {
      key,
      metrics: Object.fromEntries(
        Object.entries(metricUnits).map(([name, unit]) => {
          const baseline = group
            .filter(({ target }) => target === "baseline")
            .map((sample) => sample.metrics[name].value)
            .filter((value) => Number.isFinite(value));
          const candidate = group
            .filter(({ target }) => target === "candidate")
            .map((sample) => sample.metrics[name].value)
            .filter((value) => Number.isFinite(value));
          const baselineMedian = median(baseline);
          const candidateMedian = median(candidate);
          return [
            name,
            {
              absoluteDelta: metric(
                Number.isFinite(baselineMedian) &&
                  Number.isFinite(candidateMedian)
                  ? candidateMedian - baselineMedian
                  : null,
                unit
              ),
              baselineMedian: metric(baselineMedian, unit),
              bootstrap95MedianDelta: bootstrapMedianDelta(
                baseline,
                candidate,
                unit
              ),
              candidateMedian: metric(candidateMedian, unit),
              relativeDelta: metric(
                Number.isFinite(baselineMedian) &&
                  Number.isFinite(candidateMedian) &&
                  baselineMedian !== 0
                  ? (candidateMedian - baselineMedian) / baselineMedian
                  : null,
                "ratio"
              ),
            },
          ];
        })
      ),
    };
  });
};

const characterizeIndependentSeries = (measured) => {
  const keys = [
    ...new Set(
      measured.map((sample) =>
        [
          sample.target,
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":")
      )
    ),
  ];
  return keys.map((key) => {
    const group = measured.filter(
      (sample) =>
        [
          sample.target,
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":") === key
    );
    const series = [...new Set(group.map((sample) => sample.series))].sort();
    return {
      metrics: Object.fromEntries(
        Object.entries({
          cls: "score",
          fcp: "milliseconds",
          longTasksTotal: "milliseconds",
          ttfb: "milliseconds",
        }).map(([name, unit]) => {
          const medians = series.map((seriesNumber) =>
            median(
              group
                .filter((sample) => sample.series === seriesNumber)
                .map((sample) => sample.metrics[name].value)
                .filter((value) => Number.isFinite(value))
            )
          );
          const finite = medians.filter((value) => Number.isFinite(value));
          const lowest = finite.length ? Math.min(...finite) : null;
          const highest = finite.length ? Math.max(...finite) : null;
          return [
            name,
            {
              medianSpread: metric(
                Number.isFinite(lowest) &&
                  Number.isFinite(highest) &&
                  lowest > 0
                  ? (highest - lowest) / lowest
                  : null,
                "ratio"
              ),
              seriesMedians: medians.map((value) => metric(value, unit)),
            },
          ];
        })
      ),
      key,
      status: series.length >= 2 ? "characterized" : "incomplete",
    };
  });
};

const compareHarnessModes = (measured, allRequests, target) => {
  const select = (mode) =>
    measured.filter(
      (sample) =>
        sample.target === target &&
        sample.scenario.id === "home" &&
        sample.scenario.device === "mobile" &&
        sample.scenario.cacheState === "cold" &&
        sample.scenario.harnessMode === mode
    );
  const observer = select("observer");
  const control = select("control");
  const metricMedian = (group, name) =>
    median(
      group
        .map((sample) => sample.metrics[name]?.value)
        .filter((value) => Number.isFinite(value))
    );
  const requestSignature = (group) => {
    const sampleIds = new Set(group.map(({ sampleId }) => sampleId));
    const counts = allRequests
      .filter(({ sampleId }) => sampleIds.has(sampleId))
      .reduce((result, request) => {
        const key = [
          request.category,
          request.safePath,
          request.resourceType,
        ].join(":");
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {});
    const divisor = Math.max(1, group.length);
    return Object.fromEntries(
      Object.entries(counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => [key, count / divisor])
    );
  };
  const observerFcp = metricMedian(observer, "fcp");
  const controlFcp = metricMedian(control, "fcp");
  const observerCls = metricMedian(observer, "cls");
  const controlCls = metricMedian(control, "cls");
  const timingShiftRatio =
    Number.isFinite(observerFcp) &&
    Number.isFinite(controlFcp) &&
    controlFcp > 0
      ? (observerFcp - controlFcp) / controlFcp
      : null;
  const requestSignaturesEqual =
    JSON.stringify(requestSignature(observer)) ===
    JSON.stringify(requestSignature(control));
  const clsDelta =
    Number.isFinite(observerCls) && Number.isFinite(controlCls)
      ? observerCls - controlCls
      : null;
  const pass =
    observer.length === control.length &&
    observer.length > 0 &&
    requestSignaturesEqual &&
    (clsDelta === null || clsDelta <= 0.01) &&
    (timingShiftRatio === null || timingShiftRatio <= 0.05);
  return {
    clsDelta: metric(clsDelta, "score"),
    requestSignaturesEqual,
    samplesPerMode: metric(observer.length, "count"),
    status: pass ? "pass" : "fail",
    timingShiftRatio: metric(timingShiftRatio, "ratio"),
  };
};

const summarize = ({ allRequests, allSamples, options, builds }) => {
  const measured = allSamples.filter((sample) => sample.measured);
  const scenarioKeys = [
    ...new Set(
      measured.map((sample) =>
        [
          sample.target,
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":")
      )
    ),
  ];
  const scenarioSummaries = scenarioKeys.map((key) => {
    const group = measured.filter(
      (sample) =>
        [
          sample.target,
          sample.scenario.id,
          sample.scenario.device,
          sample.scenario.cacheState,
          sample.scenario.harnessMode,
        ].join(":") === key
    );
    const requestGroup = allRequests.filter((request) =>
      group.some((sample) => sample.sampleId === request.sampleId)
    );
    return {
      key,
      metrics: {
        activation: summarizeMetric(group, "activation", "milliseconds"),
        cls: summarizeMetric(group, "cls", "score"),
        fcp: summarizeMetric(group, "fcp", "milliseconds"),
        firstFeedback: summarizeMetric(group, "firstFeedback", "milliseconds"),
        jsDecodedBytes: summarizeMetric(group, "jsDecodedBytes", "bytes"),
        longTasksTotal: summarizeMetric(
          group,
          "longTasksTotal",
          "milliseconds"
        ),
        maxTask: summarizeMetric(group, "maxTask", "milliseconds"),
        takeover: summarizeMetric(group, "takeover", "milliseconds"),
        ttfb: summarizeMetric(group, "ttfb", "milliseconds"),
      },
      requestBaseline: Object.entries(
        requestGroup.reduce((counts, request) => {
          counts[request.category] = (counts[request.category] ?? 0) + 1;
          return counts;
        }, {})
      )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, count]) => ({
          category,
          count: metric(count, "count"),
        })),
      samples: metric(group.length, "count"),
    };
  });
  const isCanonical =
    options.warmups === canonicalSampling.warmups &&
    options.samples === canonicalSampling.measured &&
    options.series === canonicalSampling.series &&
    options.selectedScenarios.length === scenarios.length &&
    options.selectedDevices.length === Object.keys(devices).length &&
    options.selectedCaches.length === cacheStates.length;
  const harnessComparisons = Object.fromEntries(
    ["baseline", "candidate"].map((target) => [
      target,
      compareHarnessModes(measured, allRequests, target),
    ])
  );
  const harnessPass = Object.values(harnessComparisons).every(
    ({ status }) => status === "pass"
  );
  const phaseSamples = measured.filter(
    (sample) =>
      sample.target === "candidate" &&
      sample.ssr?.phases?.unit === "milliseconds"
  );
  const pageErrors = measured.reduce(
    (count, sample) => count + (sample.errors.count.value ?? 0),
    0
  );
  const deterministicGates = {
    harnessNoRegression: isCanonical && harnessPass,
    requestImportBaseline: isCanonical && allRequests.length > 0,
    ssrPhaseAttribution: phaseSamples.length > 0,
    timestampDeadlineCalibration: isCanonical,
    zeroPageErrors: pageErrors === 0,
  };
  const auditGroup = measured.filter(
    (sample) =>
      sample.target === "baseline" &&
      sample.scenario.id === "home" &&
      sample.scenario.device === "mobile" &&
      sample.scenario.cacheState === "cold" &&
      sample.scenario.harnessMode === "observer"
  );
  const auditMedian = (name) =>
    median(
      auditGroup
        .map((sample) => sample.metrics[name].value)
        .filter((value) => Number.isFinite(value))
    );
  const categoryBytesMedian = (category) => {
    const bySample = auditGroup.map(({ sampleId }) =>
      allRequests
        .filter(
          (request) =>
            request.sampleId === sampleId && request.category === category
        )
        .reduce(
          (bytes, request) => bytes + (request.decodedBytes.value ?? 0),
          0
        )
    );
    return median(bySample);
  };
  return {
    absoluteCaps: {
      auth0: {
        anonymousDecodedJs: metric(
          Math.max(
            0,
            (auditMedian("jsDecodedBytes") ?? 0) -
              (categoryBytesMedian("auth0") ?? 0)
          ),
          "bytes"
        ),
        basis:
          "measured Stage 0 home decoded JavaScript minus requested Auth0 JavaScript",
        frozen: isCanonical,
      },
      homeColdMobile: {
        cls: { frozen: isCanonical, unit: "score", value: 0.01 },
        decodedJs: { frozen: isCanonical, unit: "bytes", value: 850_000 },
        fcp: { frozen: isCanonical, unit: "milliseconds", value: 750 },
        longTasks: { frozen: isCanonical, unit: "milliseconds", value: 650 },
        maxTask: { frozen: isCanonical, unit: "milliseconds", value: 200 },
      },
      scheduleColdMobile: {
        cls: { frozen: isCanonical, unit: "score", value: 0.03 },
        fcp: { frozen: isCanonical, unit: "milliseconds", value: 1_100 },
        longTasks: { frozen: isCanonical, unit: "milliseconds", value: 650 },
        maxTask: { frozen: isCanonical, unit: "milliseconds", value: 300 },
      },
    },
    auditReproduction: {
      baseline: {
        homeColdMobile: {
          decodedJs: metric(1_125_909, "bytes"),
          jsRequests: metric(58, "count"),
          longTasks: metric(968, "milliseconds"),
        },
        commit: builds.baseline.commit,
      },
      disposition:
        "deterministic loopback fixture characterizes variance; retained production audit values are not mixed into fixture acceptance",
      fixtureObserved: {
        decodedJs: metric(auditMedian("jsDecodedBytes"), "bytes"),
        jsRequests: metric(auditMedian("jsRequests"), "count"),
        longTasks: metric(auditMedian("longTasksTotal"), "milliseconds"),
      },
    },
    canonicalSampling: isCanonical,
    comparisons: comparisonSummaries(measured),
    deadlineCalibration: {
      clockSkew: { ...RUNTIME_BROWSER_CLOCK_SKEW, frozen: isCanonical },
      sources: Object.fromEntries(
        Object.entries(RUNTIME_BROWSER_DEADLINES).map(([source, deadline]) => [
          source,
          {
            ...deadline,
            basis: "PRD timestamp contract plus two independent fixture series",
            frozen: isCanonical,
          },
        ])
      ),
      timestampContract: {
        scheduleApi: "epoch-seconds",
        sourceAges: "milliseconds",
        ssrIso: "epoch-milliseconds",
      },
    },
    deterministicGates,
    generatedAt: new Date().toISOString(),
    harnessNoRegression: {
      comparisons: harnessComparisons,
      improvementRequired: false,
      productArtifactHashesEqualWithinTarget: true,
      status:
        isCanonical && harnessPass
          ? "pass"
          : isCanonical
            ? "fail"
            : "incomplete-noncanonical-sampling",
    },
    importBaselines: {
      baseline: builds.baseline.manifest,
      candidate: builds.candidate.manifest,
    },
    sampling: {
      measured: metric(options.samples, "count"),
      series: metric(options.series, "count"),
      warmups: metric(options.warmups, "count"),
    },
    rolloutMinimums: {
      eligibleSurfaceLoads: { unit: "count", value: 1_000 },
      observationWindow: { unit: "milliseconds", value: 86_400_000 },
      productionColdSamplesPerWindow: { unit: "count", value: 5 },
      productionWindows: { unit: "count", value: 2 },
    },
    seriesVariance: characterizeIndependentSeries(measured),
    scenarios: scenarioSummaries,
    schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
  };
};

const evidence = (artifactHash, kind) => [{ artifactHash, kind }];

const main = async () => {
  const startedAt = new Date().toISOString();
  const options = parseArgs(process.argv.slice(2));
  const command = `yarn benchmark:browser-runtime -- ${process.argv.slice(2).join(" ")}`;
  const commits = {
    baseline: resolveCommit(options.baseline),
    candidate: resolveCommit(options.candidate),
  };
  const uniqueBuilds = new Map();
  const builds = {};
  let browser;
  const fixtures = [];
  try {
    for (const target of ["baseline", "candidate"]) {
      const commit = commits[target];
      if (!uniqueBuilds.has(commit)) {
        process.stdout.write(`Building ${target} ${commit}\n`);
        uniqueBuilds.set(commit, prepareWorkspace(commit));
      }
      builds[target] = uniqueBuilds.get(commit);
    }
    fs.mkdirSync(path.join(options.output, commits.candidate), {
      recursive: true,
    });
    const runId = new Date().toISOString().replaceAll(":", "-");
    const runRoot = path.join(options.output, commits.candidate, runId);
    const writer = createImmutableReceiptWriter(runRoot);
    browser = await chromium.launch({
      args: [
        "--host-resolver-rules=MAP ferry.fyi 127.0.0.1, MAP howmanyboats.today 127.0.0.1, MAP * ~NOTFOUND",
        "--ignore-certificate-errors",
      ],
      headless: true,
    });
    const allSamples = [];
    const allRequests = [];
    for (const [targetIndex, target] of ["baseline", "candidate"].entries()) {
      const fixture = await startFixture(builds[target], 4277 + targetIndex);
      fixtures.push(fixture);
      for (let series = 1; series <= options.series; series += 1) {
        for (const scenario of options.selectedScenarios) {
          for (const deviceName of options.selectedDevices) {
            for (const cacheState of options.selectedCaches) {
              const harnessModes =
                scenario.id === "home" &&
                deviceName === "mobile" &&
                cacheState === "cold"
                  ? harnessModesForSeries(series)
                  : ["observer"];
              for (const harnessMode of harnessModes) {
                let warmContext;
                if (cacheState === "warm") {
                  warmContext = await browser.newContext({
                    ...devices[deviceName],
                    ignoreHTTPSErrors: true,
                    serviceWorkers: "allow",
                    viewport: {
                      height: devices[deviceName].height,
                      width: devices[deviceName].width,
                    },
                  });
                }
                const total = options.warmups + options.samples;
                for (let index = 0; index < total; index += 1) {
                  await requestJson(
                    `https://127.0.0.1:${fixture.port}/__fixture__/reset`,
                    { method: "POST" }
                  );
                  const measured = index >= options.warmups;
                  const sampleIndex = measured
                    ? index - options.warmups + 1
                    : index + 1;
                  process.stdout.write(
                    `${target} s${series} ${scenario.id}/${deviceName}/${cacheState}/${harnessMode} ${
                      measured
                        ? `sample ${sampleIndex}`
                        : `warmup ${sampleIndex}`
                    }\n`
                  );
                  const result = await sampleOnce({
                    browser,
                    build: builds[target],
                    cacheState,
                    deviceName,
                    fixture,
                    harnessMode,
                    measured,
                    sampleIndex,
                    scenario,
                    series,
                    settleMs: options.settleMs,
                    target,
                    warmContext,
                  });
                  writer.appendSample(result.sample);
                  result.requestEvidence.forEach((request) =>
                    writer.appendRequest(request)
                  );
                  allSamples.push(result.sample);
                  allRequests.push(...result.requestEvidence);
                }
                if (warmContext) await warmContext.close();
              }
            }
          }
        }
      }
      await stopFixture(fixture);
    }
    const summary = summarize({ allRequests, allSamples, builds, options });
    const environment = {
      browser: { name: "chromium", version: browser.version() },
      builds: {
        baseline: {
          artifactHash: builds.baseline.artifactHash,
          commit: commits.baseline,
        },
        candidate: {
          artifactHash: builds.candidate.artifactHash,
          commit: commits.candidate,
        },
      },
      collectedAt: new Date().toISOString(),
      cpu: { count: os.cpus().length, model: os.cpus()[0]?.model ?? "unknown" },
      network: {
        delivery:
          "loopback fixture; third-party delivery blocked; SSR cache reset before navigation",
        profiles: Object.fromEntries(
          options.selectedDevices.map((name) => [
            name,
            {
              cpuSlowdown: {
                unit: "ratio",
                value: performanceProfiles[name].cpuSlowdown,
              },
              download: {
                unit: "bytes-per-second",
                value: performanceProfiles[name].downloadBytesPerSecond,
              },
              latency: {
                unit: "milliseconds",
                value: performanceProfiles[name].latencyMs,
              },
              upload: {
                unit: "bytes-per-second",
                value: performanceProfiles[name].uploadBytesPerSecond,
              },
            },
          ])
        ),
      },
      node: process.version,
      os: { arch: os.arch(), platform: os.platform(), release: os.release() },
      sampling: summary.sampling,
      schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
      viewports: Object.fromEntries(
        options.selectedDevices.map((name) => [name, devices[name]])
      ),
    };
    const summaryHash = sha256(`${JSON.stringify(summary, null, 2)}\n`);
    const canonical = summary.canonicalSampling;
    const accepted =
      canonical && Object.values(summary.deterministicGates).every(Boolean);
    const receipt = {
      androidEvidence: [],
      baselineCommit: commits.baseline,
      browserEvidence: evidence(summaryHash, "runtime-browser-summary"),
      candidateCommit: commits.candidate,
      command,
      completedAt: new Date().toISOString(),
      deterministicGates: [
        { id: "immutable-schema", status: "pass" },
        {
          id: "request-import-baseline",
          status: summary.deterministicGates.requestImportBaseline
            ? "pass"
            : "incomplete",
        },
        {
          id: "harness-no-regression",
          status: summary.deterministicGates.harnessNoRegression
            ? "pass"
            : "incomplete",
        },
        {
          id: "timestamp-deadline-calibration",
          status: summary.deterministicGates.timestampDeadlineCalibration
            ? "pass"
            : "incomplete",
        },
        {
          id: "ssr-phase-attribution",
          status: summary.deterministicGates.ssrPhaseAttribution
            ? "pass"
            : "incomplete",
        },
        {
          id: "zero-page-errors",
          status: summary.deterministicGates.zeroPageErrors
            ? "pass"
            : "blocked",
        },
      ],
      disposition: accepted ? "accepted" : canonical ? "blocked" : "incomplete",
      functionalEvidence: evidence(
        builds.candidate.artifactHash,
        "candidate-production-artifacts"
      ),
      impacts: { android: false, ios: false, web: true },
      iosEvidence: [],
      receiptId: "0",
      rolloutEvidence: [],
      scenarios: summary.scenarios.map(({ key }) => key),
      schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
      startedAt,
      timingGates: [
        {
          id: "calibration-only",
          improvementRequired: false,
          status: canonical ? "characterized" : "incomplete",
        },
      ],
    };
    writer.finalize({ environment, receipt, summary });
    process.stdout.write(`Receipt artifacts: ${runRoot}\n`);
  } finally {
    if (browser) await browser.close();
    await Promise.all(fixtures.map((fixture) => stopFixture(fixture)));
    if (!options?.keepWorktrees) {
      for (const build of uniqueBuilds.values()) removeWorkspace(build);
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
