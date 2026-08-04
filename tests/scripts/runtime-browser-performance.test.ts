import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  categorizeRequest,
  createImmutableReceiptWriter,
  harnessModesForSeries,
  RUNTIME_BROWSER_SCHEMA_VERSION,
  sha256,
  validateReceipt,
  validateRequest,
  validateSample,
} from "../../scripts/runtime-browser-performance-contract.mjs";

const temporaryDirectories: string[] = [];
const artifactHash = sha256("artifact");
const commit = "504a84074ef9e4e2ae36c1c4f9d071a78a533348";

const sample = () => ({
  artifactHash,
  commit,
  measured: true,
  metrics: {
    fcp: { unit: "milliseconds", value: 100 },
  },
  sampleId: "baseline:1:home:mobile:cold:observer:1",
  sampleIndex: 1,
  scenario: {
    cacheState: "cold",
    device: "mobile",
    harnessMode: "observer",
    id: "home",
    path: "/",
  },
  schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
  series: 1,
  target: "baseline",
});

const request = () => ({
  artifactHash,
  category: "features",
  decodedBytes: { unit: "bytes", value: 10 },
  originClass: "first-party",
  resourceType: "fetch",
  safePath: "/api/features",
  sampleId: sample().sampleId,
  schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
  target: "baseline",
});

const receipt = () => ({
  androidEvidence: [],
  baselineCommit: commit,
  browserEvidence: [{ artifactHash, kind: "summary" }],
  candidateCommit: commit,
  command: `yarn benchmark:browser-runtime -- --baseline ${commit} --candidate ${commit} --receipt 0`,
  completedAt: "2026-08-04T00:00:01.000Z",
  deterministicGates: [{ id: "schema", status: "pass" }],
  disposition: "accepted",
  functionalEvidence: [{ artifactHash, kind: "build" }],
  impacts: { android: false, ios: false, web: true },
  iosEvidence: [],
  receiptId: "0",
  rolloutEvidence: [],
  scenarios: ["baseline:home"],
  schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
  startedAt: "2026-08-04T00:00:00.000Z",
  timingGates: [
    {
      id: "calibration-only",
      improvementRequired: false,
      status: "characterized",
    },
  ],
});

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { force: true, recursive: true })
    );
});

describe("runtime browser performance receipt contract", () => {
  it("balances observer and control ordering across independent series", () => {
    expect(harnessModesForSeries(1)).toEqual(["observer", "control"]);
    expect(harnessModesForSeries(2)).toEqual(["control", "observer"]);
  });

  it("categorizes requests without retaining query or credential values", () => {
    expect(
      categorizeRequest(
        "https://ferry.fyi/api/features?token=never-store-this",
        "fetch"
      )
    ).toEqual({
      category: "features",
      originClass: "first-party",
      safePath: "/api/features",
    });
    expect(
      categorizeRequest(
        "https://tenant.auth0.com/authorize?code=never-store-this",
        "document"
      )
    ).toEqual({
      category: "auth0",
      originClass: "third-party",
      safePath: "[category-only]",
    });
  });

  it("rejects unknown units, missing evidence hashes, and unsafe paths", () => {
    expect(() =>
      validateSample({
        ...sample(),
        metrics: { fcp: { unit: "seconds", value: 1 } },
      })
    ).toThrow(/Unknown unit/);
    expect(() =>
      validateReceipt({
        ...receipt(),
        browserEvidence: [{ artifactHash: "missing", kind: "summary" }],
      })
    ).toThrow(/artifactHash/);
    expect(() =>
      validateRequest({ ...request(), safePath: "/api/features?private=yes" })
    ).toThrow(/query or fragment/);
    expect(() =>
      validateRequest({ ...request(), frameToken: "never-store-this" })
    ).toThrow(/Sensitive value/);
    expect(() =>
      validateRequest({ ...request(), safeQuery: "private=yes" })
    ).toThrow(/Sensitive value/);
  });

  it("appends immutable JSONL samples and finalizes every required artifact once", () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-receipt-test-")
    );
    temporaryDirectories.push(parent);
    const root = path.join(parent, "run");
    const writer = createImmutableReceiptWriter(root);
    writer.appendSample(sample());
    writer.appendRequest(request());
    expect(() => writer.appendSample(sample())).toThrow(
      /Duplicate immutable sample/
    );
    const summary = {
      deadlineCalibration: { sources: {} },
      scenarios: [],
      schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
    };
    const environment = {
      builds: {
        baseline: { artifactHash, commit },
        candidate: { artifactHash, commit },
      },
      collectedAt: "2026-08-04T00:00:00.000Z",
      schemaVersion: RUNTIME_BROWSER_SCHEMA_VERSION,
    };
    writer.finalize({ environment, receipt: receipt(), summary });

    expect(
      [
        "environment.json",
        "receipt.json",
        "requests.jsonl",
        "samples.jsonl",
        "summary.json",
      ].every((file) => fs.existsSync(path.join(root, file)))
    ).toBe(true);
    expect(fs.statSync(path.join(root, "samples.jsonl")).mode & 0o222).toBe(0);
    expect(() => writer.appendRequest(request())).toThrow(/finalized/);
    expect(() => createImmutableReceiptWriter(root)).toThrow();
  });
});
