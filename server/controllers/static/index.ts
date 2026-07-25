import compression from "compression";
import express, { Router } from "express";
import { readFileSync } from "fs";
import path from "path";

import { leaderboardsEnabled } from "~/lib/leaderboardFlags";
import { filterLeaderboardLlms } from "~/lib/leaderboardSeo";

import { browserRouter, clientDist, createBrowserRouter } from "./browser";

export const createStaticRouter = (dist = clientDist): Router => {
  const staticRouter = Router();

  staticRouter.use(compression());
  staticRouter.get("/llms.txt", async (request, response) => {
    const llms = readFileSync(path.resolve(dist, "llms.txt"), "utf-8");
    const content = filterLeaderboardLlms(llms, await leaderboardsEnabled());
    return response.type("text/plain").send(content);
  });
  staticRouter.use(express.static(dist, { index: false }));
  staticRouter.use(
    dist === clientDist ? browserRouter : createBrowserRouter(dist)
  );

  return staticRouter;
};

export const staticRouter = createStaticRouter();
