import { Request, Response, Router } from "express";
import { isObject } from "shared/lib/objects";

import { requireTypedConfirmation } from "./confirmation";

export const adminFeaturesRouter = Router();
// supported policy flags
const featureFlags = ["leaderboards", "automaticLeaderboardCheckins"] as const;

// validate explicit subject identities
const validSubjects = (input: unknown): input is string[] =>
  Array.isArray(input) &&
  // constrain every subject value
  input.every(
    (subject) => typeof subject === "string" && subject.length <= 300
  );

// register one explicit feature control surface
const registerFeatureFlagRoutes = (
  featureFlag: (typeof featureFlags)[number]
) => {
  const killSwitchTarget = `feature:${featureFlag}:kill-switch`;

  // expose current policy state
  adminFeaturesRouter.get(
    `/${featureFlag}`,
    async (_request: Request, response: Response) => {
      const { getFeatureFlagState } = await import("~/lib/leaderboardFlags");
      response.send(await getFeatureFlagState(featureFlag));
    }
  );

  // update global and subject access
  adminFeaturesRouter.put(
    `/${featureFlag}`,
    async (request: Request, response: Response) => {
      // reject mixed kill-switch updates
      if (
        !isObject(request.body) ||
        typeof request.body.enabled !== "boolean" ||
        !validSubjects(request.body.subjects) ||
        "killSwitch" in request.body
      ) {
        response.status(400).send({ error: "Invalid feature settings" });
        return;
      }
      const { updateFeatureFlagState } = await import("~/lib/leaderboardFlags");
      response.send(
        await updateFeatureFlagState(featureFlag, {
          enabled: request.body.enabled,
          subjects: request.body.subjects,
        })
      );
    }
  );

  // update kill state with typed confirmation
  adminFeaturesRouter.put(
    `/${featureFlag}/kill-switch`,
    requireTypedConfirmation({
      action: "set-feature-kill-switch",
      // bind the exact feature target
      getTarget: () => killSwitchTarget,
    }),
    async (request: Request, response: Response) => {
      // require one boolean state
      if (typeof request.body.enabled !== "boolean") {
        response.status(400).send({ error: "Invalid kill switch state" });
        return;
      }
      const { updateFeatureFlagState } = await import("~/lib/leaderboardFlags");
      response.send(
        await updateFeatureFlagState(featureFlag, {
          killSwitch: request.body.enabled,
        })
      );
    }
  );
};

// install supported policy routes
for (const featureFlag of featureFlags) {
  registerFeatureFlagRoutes(featureFlag);
}
