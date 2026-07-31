import express, { Router } from "express";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  crawlerPolicy: {
    aiCrawlers: "allow" as "allow" | "disallow",
    disallowPaths: [] as string[],
  },
  leaderboardIndexingEnabled: true,
}));
const content = vi.hoisted(() => ({
  getPublicContent: vi.fn(),
  getRobotsTxt: vi.fn(),
}));
const sitemap = vi.hoisted(() => ({ getSitemap: vi.fn() }));

vi.mock("~/services/public/content", () => content);
vi.mock("~/lib/leaderboardFlags", () => ({
  isPublicFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/getSitemap", () => sitemap);
vi.mock("../../../server/controllers/static/browser", () => ({
  browserRouter: Router(),
  clientDist: "/unused",
  createBrowserRateLimiter:
    () => (_request: unknown, _response: unknown, next: () => void) =>
      next(),
  createBrowserRouter: () => Router(),
}));

import { createStaticRouter } from "../../../server/controllers/static";

let dist: string;

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), "ferry-public-content-"));
  writeFileSync(path.join(dist, "robots.txt"), "stale static robots");
  writeFileSync(
    path.join(dist, "llms.txt"),
    "before\n<!-- LEADERBOARDS:START -->\nboards\n<!-- LEADERBOARDS:END -->\nafter"
  );
  content.getPublicContent.mockImplementation(() =>
    Promise.resolve({
      announcements: [],
      crawlerPolicy: state.crawlerPolicy,
      leaderboardIndexingEnabled: state.leaderboardIndexingEnabled,
      leaderboardSharingEnabled: true,
      maintenance: { enabled: false, message: "" },
    })
  );
  content.getRobotsTxt.mockImplementation(
    (policy) => `dynamic robots ${policy.aiCrawlers}`
  );
  sitemap.getSitemap.mockImplementation(() =>
    Promise.resolve(
      Buffer.from(`sitemap index=${state.leaderboardIndexingEnabled}`)
    )
  );
});

afterEach(() => rmSync(dist, { force: true, recursive: true }));

describe("persisted public-content static delivery", () => {
  it("serves every discovery document before the browser navigation limiter", async () => {
    const limiter = vi.fn((_request, response) => response.sendStatus(429));
    const app = express();
    app.use(createStaticRouter(dist, { rateLimiter: limiter }));

    await request(app).get("/robots.txt").expect(200, "dynamic robots allow");
    await request(app).get("/sitemap.xml").expect(200, "sitemap index=true");
    await request(app).get("/llms.txt").expect(200);
    await request(app).get("/.well-known/assetlinks.json").expect(200);
    expect(limiter).not.toHaveBeenCalled();

    await request(app).get("/about").expect(429);
    expect(limiter).toHaveBeenCalledOnce();
  });

  it("reads changed persisted policy through a separate router before static fallback", async () => {
    const firstApp = express();
    firstApp.use(createStaticRouter(dist));

    await request(firstApp)
      .get("/robots.txt")
      .expect(200, "dynamic robots allow");
    await request(firstApp)
      .get("/sitemap.xml")
      .expect(200, "sitemap index=true");
    expect(
      (await request(firstApp).get("/llms.txt").expect(200)).text
    ).toContain("boards");

    // Simulate a committed mutation observed by a different dyno/router.
    state.crawlerPolicy = { aiCrawlers: "disallow", disallowPaths: ["/admin"] };
    state.leaderboardIndexingEnabled = false;
    const secondApp = express();
    secondApp.use(createStaticRouter(dist));

    const robots = await request(secondApp).get("/robots.txt").expect(200);
    expect(robots.text).toBe("dynamic robots disallow");
    expect(robots.text).not.toContain("stale static robots");
    await request(secondApp)
      .get("/sitemap.xml")
      .expect(200, "sitemap index=false");
    const llms = await request(secondApp).get("/llms.txt").expect(200);
    expect(llms.text).not.toContain("boards");
  });
});
