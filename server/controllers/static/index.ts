import compression from "compression";
import express, { type RequestHandler, Router } from "express";
import { readFileSync } from "fs";
import path from "path";

import { getSitemap } from "~/getSitemap";
import { filterLeaderboardLlms } from "~/lib/leaderboardSeo";

import {
  browserRouter,
  clientDist,
  createBrowserRateLimiter,
  createBrowserRouter,
} from "./browser";

export interface StaticRouterDependencies {
  rateLimiter?: RequestHandler;
}

export const createStaticRouter = (
  dist = clientDist,
  dependencies: StaticRouterDependencies = {}
): Router => {
  const staticRouter = Router();

  staticRouter.use(compression());
  // Apply the same public-request limit before dynamic public documents and
  // static assets. These document endpoints may query persisted state or build
  // a sitemap, so they must not bypass the browser router's limiter.
  staticRouter.use(dependencies.rateLimiter ?? createBrowserRateLimiter());
  // These public documents are policy-controlled and must win over files in
  // dist. Keeping them before express.static makes every dyno read persisted
  // state rather than serving a deploy-time snapshot.
  staticRouter.get("/robots.txt", async (_request, response) => {
    const { getPublicContent, getRobotsTxt } =
      await import("~/lib/admin/content");
    const content = await getPublicContent();
    return response
      .type("text/plain")
      .send(getRobotsTxt(content.crawlerPolicy));
  });
  staticRouter.get("/sitemap.xml", async (_request, response) => {
    const sitemap = await getSitemap();
    return response.type("text/xml").send(sitemap);
  });
  staticRouter.get("/llms.txt", async (request, response) => {
    const { getPublicContent } = await import("~/lib/admin/content");
    const { isPublicFeatureEnabled } = await import("~/lib/leaderboardFlags");
    const llms = readFileSync(path.resolve(dist, "llms.txt"), "utf-8");
    const contentState = await getPublicContent();
    const content = filterLeaderboardLlms(
      llms,
      (await isPublicFeatureEnabled("leaderboards")) &&
        contentState.leaderboardIndexingEnabled
    );
    return response.type("text/plain").send(content);
  });
  staticRouter.use(express.static(dist, { index: false }));
  staticRouter.use(
    dist === clientDist ? browserRouter : createBrowserRouter(dist)
  );

  return staticRouter;
};

export const staticRouter = createStaticRouter();
