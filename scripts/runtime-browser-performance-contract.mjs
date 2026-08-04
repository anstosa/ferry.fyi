import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUNTIME_BROWSER_SCHEMA_VERSION = 1;
export const RUNTIME_BROWSER_ALLOWED_UNITS = Object.freeze([
  "bytes",
  "bytes-per-second",
  "count",
  "epoch-milliseconds",
  "epoch-seconds",
  "milliseconds",
  "ratio",
  "score",
]);
export const RUNTIME_BROWSER_DEADLINES = Object.freeze({
  cameraFrames: { unit: "milliseconds", value: 10_000 },
  features: { unit: "milliseconds", value: 300_000 },
  schedule: { unit: "milliseconds", value: 30_000 },
  vessels: { unit: "milliseconds", value: 60_000 },
});
export const RUNTIME_BROWSER_CLOCK_SKEW = Object.freeze({
  unit: "milliseconds",
  value: 120_000,
});

const SENSITIVE_KEYS = new Set([
  "authorization",
  "callbackcode",
  "callbackstate",
  "code",
  "cookie",
  "credential",
  "email",
  "exactlocation",
  "password",
  "query",
  "state",
  "ticketid",
  "token",
  "userid",
]);
const isSensitiveKey = (key) => {
  const normalized = key.replaceAll(/[^a-z]/gi, "").toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("query") ||
    normalized.endsWith("ticketid") ||
    normalized.endsWith("token") ||
    normalized.endsWith("userid") ||
    normalized === "latitude" ||
    normalized === "location" ||
    normalized === "longitude" ||
    normalized === "proximity"
  );
};
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const invariant = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const walk = (value, visit, keys = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, [...keys, String(index)]));
    return;
  }
  if (!isObject(value)) {
    visit(value, keys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, [...keys, key]);
    walk(child, visit, [...keys, key]);
  }
};

export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const hashFile = (filePath) => sha256(fs.readFileSync(filePath));

export const hashDirectory = (directory, { exclude = () => false } = {}) => {
  invariant(
    fs.existsSync(directory),
    `Artifact directory is missing: ${directory}`
  );
  const files = [];
  const visit = (current, relative = "") => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelative = path.posix.join(relative, entry.name);
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(next, nextRelative);
      } else if (entry.isFile() && !exclude(nextRelative)) {
        files.push(`${nextRelative}\0${hashFile(next)}`);
      }
    }
  };
  visit(directory);
  invariant(files.length > 0, `Artifact directory is empty: ${directory}`);
  return sha256(files.join("\n"));
};

export const normalizeCommit = (value, label = "commit") => {
  invariant(
    typeof value === "string" && COMMIT.test(value),
    `Invalid ${label}`
  );
  return value.toLowerCase();
};

export const assertArtifactHash = (value, label = "artifact hash") => {
  invariant(typeof value === "string" && HASH.test(value), `Invalid ${label}`);
};

export const assertKnownUnits = (value) => {
  walk(value, (child, keys) => {
    const key = keys.at(-1);
    if (key?.toLowerCase().endsWith("unit")) {
      invariant(
        RUNTIME_BROWSER_ALLOWED_UNITS.includes(child),
        `Unknown unit at ${keys.join(".")}: ${String(child)}`
      );
    }
  });
};

export const assertNoSensitiveValues = (value) => {
  walk(value, (child, keys) => {
    const key = keys.at(-1) ?? "";
    if (isSensitiveKey(key) && child !== null && child !== false) {
      invariant(
        child === "[redacted]" || child === "[category-only]",
        `Sensitive value is not redacted at ${keys.join(".")}`
      );
    }
    if (typeof child === "string") {
      invariant(
        !/[?#]/.test(child),
        `Query or fragment found at ${keys.join(".")}`
      );
      invariant(
        !/(?:bearer\s+|eyJ[A-Za-z0-9_-]{10,}|auth0\.com\/authorize)/i.test(
          child
        ),
        `Credential-like value found at ${keys.join(".")}`
      );
    }
  });
};

const assertIsoDate = (value, label) => {
  invariant(
    typeof value === "string" && ISO_DATE.test(value),
    `Invalid ${label}`
  );
  invariant(Number.isFinite(Date.parse(value)), `Invalid ${label}`);
};

const assertEvidence = (value, label) => {
  invariant(Array.isArray(value), `${label} must be an array`);
  for (const evidence of value) {
    invariant(isObject(evidence), `${label} entry must be an object`);
    assertArtifactHash(evidence.artifactHash, `${label} artifactHash`);
  }
};

export const validateEnvironment = (environment) => {
  invariant(isObject(environment), "environment.json must contain an object");
  invariant(
    environment.schemaVersion === RUNTIME_BROWSER_SCHEMA_VERSION,
    "Unsupported environment schemaVersion"
  );
  assertIsoDate(environment.collectedAt, "environment collectedAt");
  invariant(isObject(environment.builds), "environment builds are required");
  for (const target of ["baseline", "candidate"]) {
    const build = environment.builds[target];
    invariant(isObject(build), `environment ${target} build is required`);
    normalizeCommit(build.commit, `${target} commit`);
    assertArtifactHash(build.artifactHash, `${target} artifactHash`);
  }
  assertKnownUnits(environment);
  assertNoSensitiveValues(environment);
  return environment;
};

export const validateSample = (sample) => {
  invariant(isObject(sample), "Sample must be an object");
  invariant(
    sample.schemaVersion === RUNTIME_BROWSER_SCHEMA_VERSION,
    "Unsupported sample schemaVersion"
  );
  invariant(
    typeof sample.sampleId === "string" && sample.sampleId,
    "sampleId is required"
  );
  invariant(
    ["baseline", "candidate"].includes(sample.target),
    "Invalid sample target"
  );
  normalizeCommit(sample.commit, "sample commit");
  assertArtifactHash(sample.artifactHash, "sample artifactHash");
  invariant(isObject(sample.scenario), "sample scenario is required");
  invariant(isObject(sample.metrics), "sample metrics are required");
  assertKnownUnits(sample);
  assertNoSensitiveValues(sample);
  return sample;
};

export const validateRequest = (request) => {
  invariant(isObject(request), "Request evidence must be an object");
  invariant(
    request.schemaVersion === RUNTIME_BROWSER_SCHEMA_VERSION,
    "Unsupported request schemaVersion"
  );
  invariant(
    typeof request.sampleId === "string" && request.sampleId,
    "request sampleId is required"
  );
  assertArtifactHash(request.artifactHash, "request artifactHash");
  invariant(
    typeof request.safePath === "string" && !/[?#]/.test(request.safePath),
    "request safePath must not contain a query or fragment"
  );
  assertKnownUnits(request);
  assertNoSensitiveValues(request);
  return request;
};

export const validateSummary = (summary) => {
  invariant(isObject(summary), "summary.json must contain an object");
  invariant(
    summary.schemaVersion === RUNTIME_BROWSER_SCHEMA_VERSION,
    "Unsupported summary schemaVersion"
  );
  invariant(Array.isArray(summary.scenarios), "summary scenarios are required");
  invariant(
    isObject(summary.deadlineCalibration),
    "deadline calibration is required"
  );
  assertKnownUnits(summary);
  assertNoSensitiveValues(summary);
  return summary;
};

export const validateReceipt = (receipt) => {
  invariant(isObject(receipt), "receipt.json must contain an object");
  invariant(
    receipt.schemaVersion === RUNTIME_BROWSER_SCHEMA_VERSION,
    "Unsupported receipt schemaVersion"
  );
  invariant(receipt.receiptId === "0", "Receipt 0 is required");
  normalizeCommit(receipt.baselineCommit, "baselineCommit");
  normalizeCommit(receipt.candidateCommit, "candidateCommit");
  invariant(
    typeof receipt.command === "string" && receipt.command,
    "command is required"
  );
  assertIsoDate(receipt.startedAt, "receipt startedAt");
  assertIsoDate(receipt.completedAt, "receipt completedAt");
  invariant(isObject(receipt.impacts), "receipt impacts are required");
  for (const platform of ["web", "android", "ios"]) {
    invariant(
      typeof receipt.impacts[platform] === "boolean",
      `${platform} impact is required`
    );
  }
  invariant(Array.isArray(receipt.scenarios), "receipt scenarios are required");
  invariant(
    Array.isArray(receipt.deterministicGates),
    "deterministic gates are required"
  );
  invariant(Array.isArray(receipt.timingGates), "timing gates are required");
  assertEvidence(receipt.functionalEvidence, "functionalEvidence");
  assertEvidence(receipt.browserEvidence, "browserEvidence");
  assertEvidence(receipt.androidEvidence, "androidEvidence");
  assertEvidence(receipt.iosEvidence, "iosEvidence");
  assertEvidence(receipt.rolloutEvidence, "rolloutEvidence");
  invariant(
    ["accepted", "blocked", "incomplete"].includes(receipt.disposition),
    "Invalid receipt disposition"
  );
  assertKnownUnits(receipt);
  assertNoSensitiveValues(receipt);
  return receipt;
};

const writeExclusive = (filePath, contents) => {
  fs.writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx" });
};

export const createImmutableReceiptWriter = (root) => {
  fs.mkdirSync(root, { recursive: false });
  const samplesPath = path.join(root, "samples.jsonl");
  const requestsPath = path.join(root, "requests.jsonl");
  writeExclusive(samplesPath, "");
  writeExclusive(requestsPath, "");
  const sampleIds = new Set();
  let finalized = false;
  const assertOpen = () => invariant(!finalized, "Receipt writer is finalized");
  const append = (filePath, value) => {
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  };
  return {
    appendRequest(request) {
      assertOpen();
      validateRequest(request);
      invariant(
        sampleIds.has(request.sampleId),
        "Request references an unknown sampleId"
      );
      append(requestsPath, request);
    },
    appendSample(sample) {
      assertOpen();
      validateSample(sample);
      invariant(
        !sampleIds.has(sample.sampleId),
        `Duplicate immutable sample: ${sample.sampleId}`
      );
      sampleIds.add(sample.sampleId);
      append(samplesPath, sample);
    },
    finalize({ environment, receipt, summary }) {
      assertOpen();
      validateEnvironment(environment);
      validateSummary(summary);
      validateReceipt(receipt);
      writeExclusive(
        path.join(root, "environment.json"),
        `${JSON.stringify(environment, null, 2)}\n`
      );
      writeExclusive(
        path.join(root, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`
      );
      writeExclusive(
        path.join(root, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`
      );
      for (const file of [
        "environment.json",
        "receipt.json",
        "requests.jsonl",
        "samples.jsonl",
        "summary.json",
      ]) {
        fs.chmodSync(path.join(root, file), 0o444);
      }
      finalized = true;
    },
  };
};

export const categorizeRequest = (rawUrl, resourceType = "other") => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      category: "invalid",
      originClass: "invalid",
      safePath: "[redacted]",
    };
  }
  const pathname = url.pathname;
  let category = "other";
  if (/^\/api\/features(?:\/me)?$/.test(pathname)) category = "features";
  else if (/^\/api\/terminals(?:\/|$)/.test(pathname)) category = "terminals";
  else if (/^\/api\/schedule(?:\/|$)/.test(pathname)) category = "schedule";
  else if (/auth0/i.test(`${url.hostname}${pathname}`)) category = "auth0";
  else if (/firebase|googleapis|fcm|push/i.test(`${url.hostname}${pathname}`))
    category = "firebase-push";
  else if (/nearby/i.test(pathname)) category = "nearby";
  else if (/leaderboard/i.test(pathname)) category = "leaderboard";
  else if (/camera|frame/i.test(pathname)) category = "camera";
  else if (/mapbox|styles\/v1|tiles/i.test(`${url.hostname}${pathname}`))
    category = "mapbox";
  else if (/capacitor|updater|ota/i.test(pathname)) category = "native-bridge";
  else if (/scanner|zxing|jsqr/i.test(pathname)) category = "scanner";
  else if (resourceType === "script") category = "script";
  else if (resourceType === "stylesheet") category = "style";
  else if (resourceType === "image") category = "image";
  else if (resourceType === "document") category = "document";
  const publicPath =
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/static/") ||
    pathname.startsWith("/api/features") ||
    pathname.startsWith("/api/terminals") ||
    pathname.startsWith("/api/schedule");
  return {
    category,
    originClass: [
      "ferry.fyi",
      "howmanyboats.today",
      "127.0.0.1",
      "localhost",
    ].includes(url.hostname)
      ? "first-party"
      : "third-party",
    safePath: publicPath ? pathname : `[category-only]`,
  };
};
