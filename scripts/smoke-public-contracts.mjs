#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = (args.get("--base-url") ?? process.env.BASE_URL ?? "").replace(
  /\/$/,
  ""
);
const output = args.get("--output");
const phase = args.get("--phase") ?? "final";

if (!baseUrl) {
  throw new Error("BASE_URL or --base-url is required");
}
if (!new Set(["current", "final"]).has(phase)) {
  throw new Error("--phase must be current or final");
}

const checks = [];
const check = async ({ path, status = 200, type, validate }) => {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: type ?? "*/*", "User-Agent": "ferry-fyi-smoke/1" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (response.status !== status) {
    throw new Error(`${path}: expected ${status}, received ${response.status}`);
  }
  if (type && !response.headers.get("content-type")?.includes(type)) {
    throw new Error(`${path}: unexpected content type`);
  }
  await validate?.({ body, response });
  checks.push({
    bodyHash: crypto.createHash("sha256").update(body).digest("hex"),
    durationMs: Date.now() - startedAt,
    path,
    semanticOutcome: "passed",
    status: response.status,
  });
};

await check({ path: "/healthz", type: "text/plain" });
await check({
  path: "/about",
  type: "text/html",
  validate: ({ body }) => {
    if (!/<link[^>]+rel=["']canonical["']/i.test(body)) {
      throw new Error("/about: canonical link missing");
    }
  },
});
await check({ path: "/robots.txt", type: "text/plain" });
await check({ path: "/sitemap.xml", type: "text/xml" });
await check({ path: "/llms.txt", type: "text/plain" });
await check({
  path: "/api/features",
  type: "application/json",
  validate: ({ response }) => {
    if (!response.headers.get("ratelimit")) {
      throw new Error("/api/features: standard RateLimit header missing");
    }
  },
});
await check({
  path: "/this-page-must-not-exist",
  status: 404,
  type: "text/html",
  validate: ({ response }) => {
    if (!response.headers.get("x-robots-tag")?.includes("noindex")) {
      throw new Error("browser 404: X-Robots-Tag noindex missing");
    }
  },
});

if (phase === "final") {
  await check({ path: "/readyz", type: "text/plain" });
  await check({
    path: "/api/this-operation-does-not-exist",
    status: 404,
    type: "application/json",
    validate: ({ body, response }) => {
      const parsed = JSON.parse(body);
      if (parsed?.body?.error !== "api_not_found") {
        throw new Error("unknown API contract mismatch");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("unknown API response is cacheable");
      }
    },
  });
  await check({ path: "/openapi.json", type: "application/json" });
  await check({
    path: "/.well-known/security.txt",
    type: "text/plain",
    validate: ({ body }) => {
      if (!body.includes("Canonical: https://ferry.fyi/.well-known/security.txt")) {
        throw new Error("security.txt canonical mismatch");
      }
    },
  });
}

const receipt = {
  baseOrigin: new URL(baseUrl).origin,
  checks,
  collectedAt: new Date().toISOString(),
  outcome: "passed",
  phase,
  release: process.env.RELEASE_VERSION ?? process.env.GITHUB_SHA ?? null,
  schemaVersion: 1,
  sourceSamples: [],
};
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
if (output) fs.writeFileSync(output, serialized);
process.stdout.write(serialized);
