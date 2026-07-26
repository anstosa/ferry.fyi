import { Request, Response, Router } from "express";
import { isObject } from "shared/lib/objects";

import { requireTypedConfirmation } from "./confirmation";

export const adminFeaturesRouter = Router();
const leaderboardFlag = "leaderboards";
const killSwitchTarget = "feature:leaderboards:kill-switch";

const validSubjects = (input: unknown): input is string[] =>
  Array.isArray(input) &&
  input.every(
    (subject) => typeof subject === "string" && subject.length <= 300
  );

/** Detailed controls are separate from the legacy compact feature response. */
adminFeaturesRouter.get(
  `/${leaderboardFlag}`,
  async (_request: Request, response: Response) => {
    const { getFeatureFlagState } = await import("~/lib/leaderboardFlags");
    response.send(await getFeatureFlagState(leaderboardFlag));
  }
);

adminFeaturesRouter.put(
  `/${leaderboardFlag}`,
  async (request: Request, response: Response) => {
    if (
      !isObject(request.body) ||
      typeof request.body.enabled !== "boolean" ||
      !validSubjects(request.body.subjects) ||
      "killSwitch" in request.body
    ) {
      response.status(400).send({ error: "Invalid feature settings" });
      return;
    }
    const { getFeatureFlagState, setFeatureFlagState } =
      await import("~/lib/leaderboardFlags");
    const current = await getFeatureFlagState(leaderboardFlag);
    response.send(
      await setFeatureFlagState(leaderboardFlag, {
        enabled: request.body.enabled,
        killSwitch: current.killSwitch,
        subjects: request.body.subjects,
      })
    );
  }
);

adminFeaturesRouter.put(
  `/${leaderboardFlag}/kill-switch`,
  requireTypedConfirmation({
    action: "set-feature-kill-switch",
    getTarget: () => killSwitchTarget,
  }),
  async (request: Request, response: Response) => {
    if (typeof request.body.enabled !== "boolean") {
      response.status(400).send({ error: "Invalid kill switch state" });
      return;
    }
    const { getFeatureFlagState, setFeatureFlagState } =
      await import("~/lib/leaderboardFlags");
    const current = await getFeatureFlagState(leaderboardFlag);
    response.send(
      await setFeatureFlagState(leaderboardFlag, {
        ...current,
        killSwitch: request.body.enabled,
      })
    );
  }
);
