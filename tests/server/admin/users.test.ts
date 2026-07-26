import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";

const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));
const users = vi.hoisted(() => ({ deleteFerryUserData: vi.fn() }));

vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/admin/users", () => users);
vi.mock("~/lib/leaderboardFlags", () => ({
  getLeaderboardFlags: vi.fn(),
  setAutomaticLeaderboardCheckinsEnabled: vi.fn(),
  setLeaderboardsEnabled: vi.fn(),
}));
vi.mock("express-oauth2-jwt-bearer", () => ({
  auth:
    () =>
    (
      expressRequest: Request & { auth?: { payload: { sub?: string } } },
      response: Response,
      next: NextFunction
    ): void => {
      if (expressRequest.get("authorization") !== "Bearer owner") {
        response.status(401).send({ error: "Unauthorized" });
        return;
      }
      expressRequest.auth = { payload: { sub: "auth0|owner" } };
      next();
    },
}));

import { adminRouter } from "../../../server/controllers/api/admin";
import { requireAuth } from "../../../server/controllers/api/auth";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", requireAuth, adminRouter);
  return app;
};

describe("owner user-data deletion route", () => {
  const subject = "auth0|person";
  const target = `user:${subject}`;
  const confirmation = getAdminConfirmationPhrase("delete-user-data", target)!;

  beforeEach(() => {
    auth0.getAuth0UserEmail.mockReset().mockResolvedValue("anstosa@gmail.com");
    users.deleteFerryUserData
      .mockReset()
      .mockResolvedValue({ auth0Identity: "retained", status: "complete" });
  });

  it("requires the subject-bound typed confirmation before deleting data", async () => {
    const response = await request(createApp())
      .delete(`/api/admin/users/${encodeURIComponent(subject)}`)
      .set("Authorization", "Bearer owner")
      .send({ action: "delete-user-data", confirmation, target })
      .expect(200);

    expect(response.body).toEqual({
      auth0Identity: "retained",
      status: "complete",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(users.deleteFerryUserData).toHaveBeenCalledWith(subject);
  });

  it("does not invoke deletion when confirmation targets another user", async () => {
    await request(createApp())
      .delete(`/api/admin/users/${encodeURIComponent(subject)}`)
      .set("Authorization", "Bearer owner")
      .send({
        action: "delete-user-data",
        confirmation,
        target: "user:auth0|other",
      })
      .expect(400);

    expect(users.deleteFerryUserData).not.toHaveBeenCalled();
  });
});
