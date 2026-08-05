import { NextFunction, Request, Response, Router } from "express";
import { isObject } from "shared/lib/objects";

import { adminAdsRouter } from "./admin/ads";
import { requireOwnerAdmin } from "./admin/authorization";
import { requireTypedConfirmation } from "./admin/confirmation";
import { adminContentRouter } from "./admin/content";
import { adminFeaturesRouter } from "./admin/features";
import { adminLeaderboardsRouter } from "./admin/leaderboards";
import { adminNotificationsRouter } from "./admin/notifications";
import { adminOperationsRouter } from "./admin/operations";
import { adminTicketsRouter } from "./admin/tickets";
import { adminUsersRouter } from "./admin/users";

/** Applies to successful and rejected owner-admin API responses. */
export const preventAdminCaching = (
  _request: Request,
  response: Response,
  next: NextFunction
): void => {
  response.set("Cache-Control", "no-store");
  next();
};

/**
 * Sole composition root for privileged owner-admin routes. New domain routers
 * must be mounted here, after requireOwnerAdmin, rather than from api/index.
 */
export const adminRouter = Router();

adminRouter.use(preventAdminCaching);
adminRouter.use(requireOwnerAdmin);

adminRouter.use("/users", adminUsersRouter);
adminRouter.use("/ads", adminAdsRouter);
adminRouter.use("/leaderboards", adminLeaderboardsRouter);
adminRouter.use("/operations", adminOperationsRouter);
adminRouter.use("/notifications", adminNotificationsRouter);
adminRouter.use("/content", adminContentRouter);
adminRouter.use("/tickets", adminTicketsRouter);
adminRouter.use("/features", adminFeaturesRouter);

// Legacy compact feature response retained for deployed admin clients.
adminRouter.get("/features", async (_request, response) => {
  const { getLeaderboardFlags } = await import("~/lib/leaderboardFlags");
  response.send(await getLeaderboardFlags());
});
adminRouter.put("/features", async (request, response) => {
  if (
    !isObject(request.body) ||
    typeof request.body.leaderboardsEnabled !== "boolean" ||
    ("automaticLeaderboardCheckinsEnabled" in request.body &&
      request.body.automaticLeaderboardCheckinsEnabled !== false)
  ) {
    return response.status(400).send({ error: "Invalid feature settings" });
  }
  const { setAutomaticLeaderboardCheckinsEnabled, setLeaderboardsEnabled } =
    await import("~/lib/leaderboardFlags");
  await setAutomaticLeaderboardCheckinsEnabled(false);
  return response.send({
    automaticLeaderboardCheckinsEnabled: false,
    leaderboardsEnabled: await setLeaderboardsEnabled(
      request.body.leaderboardsEnabled
    ),
  });
});

// This route exists only to exercise the confirmation boundary in server
// tests. Production mutations opt into the same middleware with a target
// derived from their trusted route resource.
if (process.env.NODE_ENV === "test") {
  adminRouter.post(
    "/__test/confirmed-safe-action",
    requireTypedConfirmation({
      action: "test-safe-mutation",
      getTarget: () => "fixture:confirmation",
    }),
    (request, response) =>
      response.send({
        confirmationRemoved: !("confirmation" in request.body),
        confirmed: true,
      })
  );
}
