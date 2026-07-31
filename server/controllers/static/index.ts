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

// Published Play signing certificates for Android App Links verification.
const ANDROID_APP_LINK_CERT_FINGERPRINTS = [
  "83:33:A0:5D:80:9C:57:19:7E:9B:64:17:7C:4F:08:8A:9F:AD:91:76:97:D2:C0:52:12:6C:87:80:63:A0:31:F2",
  "DA:FB:7E:B4:7F:20:3F:EF:78:F1:A5:DB:72:4B:1D:81:27:A8:0E:CA:4B:ED:0E:3D:03:60:0C:8D:40:0A:7A:D3",
];

const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface StaticPolicyRouterDependencies {
  llmsPath?: string;
}

export type StaticRouterDependencies = StaticPolicyRouterDependencies & {
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
  policyRouter.get("/.well-known/assetlinks.json", (_request, response) => {
    return response.type("application/json").send([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "fyi.ferry",
          sha256_cert_fingerprints: ANDROID_APP_LINK_CERT_FINGERPRINTS,
        },
      },
    ]);
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
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
      Vary: "Host",
    });
    return response.redirect(301, "/");
  });
  staticRouter.use(compression());
  // Discovery documents and built assets must remain available independently
  // of the browser navigation quota. A few reloads request dozens of assets;
  // sharing that quota could make crawlers and later reloads receive 429s.
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
              "Cache-Control": "no-store",
              "CDN-Cache-Control": "no-store",
              "Surrogate-Control": "no-store",
              Vary: "Host",
            });
          } else if (
            path.relative(dist, filePath).split(path.sep)[0] === "assets"
          ) {
            response.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
          }
        },
      })
    );
  }
  staticRouter.use(dependencies.rateLimiter ?? createBrowserRateLimiter());
  staticRouter.use(
    dependencies.browserRouter ??
      (dist === clientDist && !dependencies.browserDependencies
        ? browserRouter
        : createBrowserRouter(dist, dependencies.browserDependencies))
  );

  return staticRouter;
};

export const staticRouter = createStaticRouter();
