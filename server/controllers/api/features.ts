import { Router } from "express";

import { getLeaderboardFlags } from "~/lib/leaderboardFlags";

export const featureRouter = Router();

featureRouter.get("/", async (request, response) =>
  response.send(await getLeaderboardFlags())
);
