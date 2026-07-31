import compression from "compression";
import express, { type RequestHandler, Router } from "express";
import { readFileSync } from "fs";
import path from "path";

import { filterLeaderboardLlms } from "~/lib/leaderboardSeo";

import {
  browserRouter,
  type BrowserRouterDependencies,
  clientDist,
  createBrowserRateLimiter,
  createBrowserRouter,
} from "./browser";

export interface StaticPolicyRouterDependencies {
  llmsPath?: string;
  rateLimiter?: RequestHandler;
}

export type StaticRouterDependencies = Omit<
  StaticPolicyRouterDependencies,
  "rateLimiter"
> & {
  browserDependencies?: BrowserRouterDependencies;
  browserRouter?: Router;
  rateLimiter?: RequestHandler;
  serveStaticAssets?: boolean;
};

/** Dynamic policy documents must be mounted before development Vite middleware. */
export const createStaticPolicyRouter = (
  dist = clientDist,
  dependencies: StaticPolicyRouterDependencies = {}
): Router => {
  const policyRouter = Router();
  if (dependencies.rateLimiter) {
    policyRouter.use(dependencies.rateLimiter);
  }
  // These public documents are policy-controlled and must win over files in
  // dist. Keeping them before express.static makes every dyno read persisted
  // state rather than serving a deploy-time snapshot.
  policyRouter.get("/robots.txt", async (_request, response) => {
    const { getPublicContent, getRobotsTxt } =
      await import("~/services/public/content");
    const content = await getPublicContent();
    return response
      .type("text/plain")
      .send(getRobotsTxt(content.crawlerPolicy));
  });
  policyRouter.get("/sitemap.xml", async (_request, response) => {
    const { getSitemap } = await import("~/getSitemap");
    const sitemap = await getSitemap();
    return response.type("text/xml").send(sitemap);
  });
  policyRouter.get("/llms.txt", async (request, response) => {
    const { getPublicContent } = await import("~/services/public/content");
    const { isPublicFeatureEnabled } = await import("~/lib/leaderboardFlags");
    const llms = readFileSync(
      dependencies.llmsPath ?? path.resolve(dist, "llms.txt"),
      "utf-8"
    );
    const contentState = await getPublicContent();
    const content = filterLeaderboardLlms(
      llms,
      (await isPublicFeatureEnabled("leaderboards")) &&
        contentState.leaderboardIndexingEnabled
    );
    return response.type("text/plain").send(content);
  });
  return policyRouter;
};

export const createStaticRouter = (
  dist = clientDist,
  dependencies: StaticRouterDependencies = {}
): Router => {
  const staticRouter = Router();

  staticRouter.get("/index.html", (_request, response) => {
    response.set({
      "Cache-Control": "no-store, no-transform",
      "CDN-Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
      Vary: "Host",
    });
    return response.redirect(301, "/");
  });
  staticRouter.use(compression());
  // Apply the same public-request limit before dynamic public documents and
  // static assets. These document endpoints may query persisted state or build
  // a sitemap, so they must not bypass the browser router's limiter.
  staticRouter.use(dependencies.rateLimiter ?? createBrowserRateLimiter());
  staticRouter.use(
    createStaticPolicyRouter(dist, { llmsPath: dependencies.llmsPath })
  );
  if (dependencies.serveStaticAssets !== false) {
    staticRouter.use(
      express.static(dist, {
        index: false,
        setHeaders(response, filePath) {
          if (filePath.endsWith(".html")) {
            response.set({
              "Cache-Control": "no-store, no-transform",
              "CDN-Cache-Control": "no-store",
              "Surrogate-Control": "no-store",
              Vary: "Host",
            });
          }
        },
      })
    );
  }
  staticRouter.use(
    dependencies.browserRouter ??
      (dist === clientDist && !dependencies.browserDependencies
        ? browserRouter
        : createBrowserRouter(dist, dependencies.browserDependencies))
  );

  return staticRouter;
};

export const staticRouter = createStaticRouter();
