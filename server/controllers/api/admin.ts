import { Router } from "express";
import { isObject } from "shared/lib/objects";

import { getAuth0UserEmail } from "~/lib/auth0Admin";
import {
  getLeaderboardFlags,
  setAutomaticLeaderboardCheckinsEnabled,
  setLeaderboardsEnabled,
} from "~/lib/leaderboardFlags";

const ADMIN_EMAIL = "anstosa@gmail.com";
export const adminRouter = Router();

adminRouter.use(async (request, response, next) => {
  const subject = request.auth?.payload.sub;
  if (typeof subject !== "string") {
    return response
      .status(401)
      .send({ error: "Missing authenticated subject" });
  }
  try {
    const email = await getAuth0UserEmail(subject);
    if (email?.toLocaleLowerCase("en-US") !== ADMIN_EMAIL) {
      return response
        .status(403)
        .send({ error: "Administrator access required" });
    }
    next();
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/features", async (request, response) =>
  response.send(await getLeaderboardFlags())
);
adminRouter.put("/features", async (request, response) => {
  if (
    !isObject(request.body) ||
    typeof request.body.leaderboardsEnabled !== "boolean" ||
    typeof request.body.automaticLeaderboardCheckinsEnabled !== "boolean"
  ) {
    return response.status(400).send({ error: "Invalid feature settings" });
  }
  return response.send({
    automaticLeaderboardCheckinsEnabled:
      await setAutomaticLeaderboardCheckinsEnabled(
        request.body.automaticLeaderboardCheckinsEnabled
      ),
    leaderboardsEnabled: await setLeaderboardsEnabled(
      request.body.leaderboardsEnabled
    ),
  });
});
