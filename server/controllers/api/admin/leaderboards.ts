import { Request, Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

export const adminLeaderboardsRouter = Router();

const validSubject = (value: string): boolean =>
  value.length > 0 && value.length <= 255;
const parsePage = (value: unknown): number | undefined => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
};

adminLeaderboardsRouter.get("/metrics", async (_request, response) => {
  const { getLeaderboardMetrics } =
    await import("~/lib/admin/leaderboardModeration");
  response.send(await getLeaderboardMetrics());
});

adminLeaderboardsRouter.get("/subjects/:subject", async (request, response) => {
  if (!validSubject(request.params.subject)) {
    response.status(400).send({ error: "Invalid subject" });
    return;
  }
  const limit = parsePage(request.query.limit);
  const offset = parsePage(request.query.offset);
  if (
    (limit !== undefined && (limit < 1 || limit > 100)) ||
    (offset === undefined && request.query.offset !== undefined)
  ) {
    response.status(400).send({ error: "Invalid pagination" });
    return;
  }
  const { getLeaderboardSubjectState } =
    await import("~/lib/admin/leaderboardModeration");
  response.send(
    await getLeaderboardSubjectState(request.params.subject, { limit, offset })
  );
});

adminLeaderboardsRouter.delete(
  "/checkins/:id",
  requireTypedConfirmation({
    action: "delete-checkin",
    getTarget: (request) => `checkin:${request.params.id}`,
  }),
  async (request, response) => {
    const { deleteLeaderboardCheckin } =
      await import("~/lib/admin/leaderboardModeration");
    response.send(await deleteLeaderboardCheckin(request.params.id));
  }
);

adminLeaderboardsRouter.post(
  "/subjects/:subject/hide",
  requireTypedConfirmation({
    action: "hide-leaderboard-profile",
    getTarget: (request) =>
      validSubject(request.params.subject)
        ? `user:${request.params.subject}`
        : undefined,
  }),
  async (request, response) => {
    const { setLeaderboardProfileHidden } =
      await import("~/lib/admin/leaderboardModeration");
    response.send(
      await setLeaderboardProfileHidden(request.params.subject, true)
    );
  }
);

adminLeaderboardsRouter.post(
  "/subjects/:subject/opt-out",
  requireTypedConfirmation({
    action: "opt-out-user",
    getTarget: (request) =>
      validSubject(request.params.subject)
        ? `user:${request.params.subject}`
        : undefined,
  }),
  async (request, response) => {
    const { setLeaderboardProfileHidden } =
      await import("~/lib/admin/leaderboardModeration");
    response.send(
      await setLeaderboardProfileHidden(request.params.subject, true)
    );
  }
);

adminLeaderboardsRouter.post(
  "/subjects/:subject/reset",
  requireTypedConfirmation({
    action: "reset-leaderboard-profile",
    getTarget: (request) =>
      validSubject(request.params.subject)
        ? `user:${request.params.subject}`
        : undefined,
  }),
  async (request, response) => {
    const { resetLeaderboardProfile } =
      await import("~/lib/admin/leaderboardModeration");
    response.send(await resetLeaderboardProfile(request.params.subject));
  }
);

adminLeaderboardsRouter.post(
  "/rebuild",
  requireTypedConfirmation({
    action: "run-operation",
    getTarget: () => "operation:leaderboard-rebuild",
  }),
  async (_request: Request, response) => {
    const { isAdminOperationName, runAdminOperation } =
      await import("~/lib/admin/operations");
    if (!isAdminOperationName("leaderboard-rebuild")) {
      response.status(404).send({ error: "Unknown admin operation" });
      return;
    }
    const result = await runAdminOperation("leaderboard-rebuild");
    response.status(result.started ? 200 : 409).send(result);
  }
);
