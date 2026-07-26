import { Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

/**
 * Owner-only user-data operations. This router is mounted exclusively by the
 * admin composition root after its authorization middleware.
 */
export const adminUsersRouter = Router();

adminUsersRouter.get("/", async (request, response) => {
  const requestedPage = Number(request.query.page ?? 0);
  if (!Number.isInteger(requestedPage) || requestedPage < 0) {
    response.status(400).send({ error: "Page must be a non-negative integer" });
    return;
  }
  const query =
    typeof request.query.query === "string" ? request.query.query : undefined;
  if (query && query.trim().length > 100) {
    response.status(400).send({ error: "Search query is too long" });
    return;
  }
  const { listFerryUsers } = await import("~/lib/admin/users");
  response.send(await listFerryUsers({ page: requestedPage, query }));
});

adminUsersRouter.get("/lookup", async (request, response) => {
  const hasEmail =
    typeof request.query.email === "string" &&
    request.query.email.trim() !== "";
  const hasSubject =
    typeof request.query.subject === "string" &&
    request.query.subject.trim() !== "";
  if (hasEmail === hasSubject) {
    response
      .status(400)
      .send({ error: "Provide exactly one email or subject" });
    return;
  }
  try {
    const { lookupFerryUserSupportProfile } = await import("~/lib/admin/users");
    const result = await lookupFerryUserSupportProfile({
      email: request.query.email,
      subject: request.query.subject,
    });
    if (!result) {
      response.status(404).send({ error: "User not found" });
      return;
    }
    response.send(result);
  } catch (error) {
    response.status(400).send({
      error: error instanceof Error ? error.message : "Invalid user lookup",
    });
  }
});

adminUsersRouter.delete(
  "/:subject",
  requireTypedConfirmation({
    action: "delete-user-data",
    getTarget: (request) => `user:${request.params.subject}`,
  }),
  async (request, response) => {
    // Do not construct Sequelize while composing unrelated admin routes. This
    // endpoint is the only admin-user operation in this release, so load its
    // DB-backed service only after its confirmation has succeeded.
    const { deleteFerryUserData } = await import("~/lib/admin/users");
    response.send(await deleteFerryUserData(request.params.subject));
  }
);

adminUsersRouter.post(
  "/:subject/force-sign-out",
  requireTypedConfirmation({
    action: "force-sign-out",
    getTarget: (request) => `user:${request.params.subject}`,
  }),
  async (request, response) => {
    const { forceSignOutFerryUser } = await import("~/lib/admin/users");
    response.send(await forceSignOutFerryUser(request.params.subject));
  }
);
