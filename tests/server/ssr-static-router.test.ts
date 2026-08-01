/* eslint-disable require-await -- document runtime is an intentionally async dependency. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await writeFile(
    path.join(directory, "service-worker.js"),
    "console.log('service worker')"
  );
  await mkdir(path.join(directory, "assets"));
  await writeFile(
    path.join(directory, "assets", "main.abc123.js"),
    "console.log('hashed asset')"
  );
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
      expect(response.headers["cache-control"]).toBe("no-store");
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

  it("compresses large HTML documents and caches hashed assets immutably", async () => {
    const dist = await createDist();
    const app = express().use(
      createStaticRouter(dist, {
        browserDependencies: {
          documentRuntime: async () => ({
            headers: {},
            html: `<html><body>${"Ferry schedules ".repeat(200)}</body></html>`,
            status: 200,
          }),
        },
      })
    );

    const document = await request(app).get("/").set("Accept-Encoding", "gzip");
    expect(document.status).toBe(200);
    expect(document.headers["content-encoding"]).toBe("gzip");
    expect(document.headers["cache-control"]).toBe("no-store");

    const asset = await request(app).get("/assets/main.abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("prevents service worker scripts from being cached across deploys", async () => {
    const dist = await createDist();
    const app = express().use(createStaticRouter(dist));

    const response = await request(app).get("/service-worker.js");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["cdn-cache-control"]).toBe("no-store");
    expect(response.headers["surrogate-control"]).toBe("no-store");
  });

  it("serves built assets before applying the browser navigation limiter", async () => {
    const dist = await createDist();
    const limiter = vi.fn((_request, response) => response.sendStatus(429));
    const app = express().use(
      createStaticRouter(dist, { rateLimiter: limiter })
    );

    await request(app).get("/asset.js").expect(200, "console.log('asset')");
    expect(limiter).not.toHaveBeenCalled();

    await request(app).get("/about").expect(429);
    expect(limiter).toHaveBeenCalledOnce();
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
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, noarchive");
    expect(response.text).toContain('data-ferry-fyi-render-mode="failure"');
    expect(documentRuntime).toHaveBeenCalledOnce();
  });
});
