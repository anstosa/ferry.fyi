/* eslint-disable require-await -- document runtime is an intentionally async dependency. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStaticRouter } from "../../server/controllers/static";

const temporaryDirectories: string[] = [];
const createDist = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ferry-ssr-router-"));
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, "index.html"),
    '<html><head></head><body><div id="root"></div></body></html>'
  );
  await writeFile(path.join(directory, "asset.js"), "console.log('asset')");
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("SSR static router boundary", () => {
  it("redirects GET and HEAD index.html before the limiter with document headers", async () => {
    const dist = await createDist();
    const limiter = vi.fn((_request, _response, next) => next());
    const app = express().use(
      createStaticRouter(dist, { rateLimiter: limiter })
    );

    for (const method of ["get", "head"] as const) {
      const response = await request(app)[method]("/index.html");
      expect(response.status).toBe(301);
      expect(response.headers.location).toBe("/");
      expect(response.headers["cache-control"]).toBe("no-store, no-transform");
      expect(response.headers["cdn-cache-control"]).toBe("no-store");
      expect(response.headers["surrogate-control"]).toBe("no-store");
      expect(response.headers.vary).toContain("Host");
    }
    expect(limiter).not.toHaveBeenCalled();
  });

  it("forwards document runtime and leaves static asset caching to express", async () => {
    const dist = await createDist();
    const limiter = vi.fn((_request, _response, next) => next());
    const documentRuntime = vi.fn(async (absoluteUrl: string) => ({
      headers: { "X-SSR-Test": "yes" },
      html: `<html><body>${absoluteUrl}</body></html>`,
      status: 200,
    }));
    const app = express().use(
      createStaticRouter(dist, {
        browserDependencies: { documentRuntime },
        rateLimiter: limiter,
      })
    );

    const document = await request(app)
      .get("/about?tracking=canary")
      .set("Host", "ferry.fyi");
    expect(document.status).toBe(200);
    expect(document.headers["x-ssr-test"]).toBe("yes");
    expect(document.text).toContain("http://ferry.fyi/about?tracking=canary");
    expect(documentRuntime).toHaveBeenCalledTimes(1);
    expect(limiter).toHaveBeenCalledTimes(1);
    const asset = await request(app).get("/asset.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["x-ssr-test"]).toBeUndefined();
    expect(asset.text).toContain("asset");
  });

  it("serves a recoverable browser document when an SSR fill exceeds its deadline", async () => {
    const dist = await createDist();
    const documentRuntime = vi.fn(() => new Promise<never>(() => {}));
    const app = express().use(
      createStaticRouter(dist, {
        browserDependencies: { documentRuntime, documentTimeoutMs: 5 },
      })
    );

    const response = await request(app)
      .get("/bainbridge")
      .set("Host", "ferry.fyi");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, no-transform");
    expect(response.headers["x-robots-tag"]).toBe("noindex, noarchive");
    expect(response.text).toContain('data-ferry-fyi-render-mode="failure"');
    expect(documentRuntime).toHaveBeenCalledOnce();
  });
});
