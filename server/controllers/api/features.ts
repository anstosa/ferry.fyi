import { Router } from "express";

import {
  getFeatureFlagsForSubject,
  getLeaderboardFlags,
} from "~/lib/leaderboardFlags";

import { assignAuthUser, requireAuth } from "./auth";

export const featureRouter = Router();

/** Anonymous callers receive only globally public flags. */
featureRouter.get("/", async (_request, response) =>
  response.send(await getLeaderboardFlags())
);

/** Authenticated callers may receive a subject-specific feature decision. */
featureRouter.get(
  "/me",
  requireAuth,
  assignAuthUser,
  async (_request, response) =>
    response.send(await getFeatureFlagsForSubject(response.locals.user.sub))
);
