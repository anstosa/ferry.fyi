import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";

const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));
const users = vi.hoisted(() => ({
  deleteFerryUserData: vi.fn(),
  forceSignOutFerryUser: vi.fn(),
}));

vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/admin/sessionRevocation", () => ({
  isApplicationTokenRevoked: vi.fn().mockResolvedValue(false),
}));
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

describe("owner force sign-out route", () => {
  const subject = "auth0|person";
  const target = `user:${subject}`;
  const confirmation = getAdminConfirmationPhrase("force-sign-out", target)!;

  beforeEach(() => {
    auth0.getAuth0UserEmail.mockReset().mockResolvedValue("anstosa@gmail.com");
    users.forceSignOutFerryUser.mockReset().mockResolvedValue({
      applicationTokens: {
        expiresAt: "2026-07-25T00:00:00.000Z",
        status: "complete",
      },
      auth0: {
        deviceCredentials: "complete",
        sessions: "unavailable",
        status: "partial",
      },
      status: "partial",
    });
  });

  it("requires a subject-bound confirmation and returns truthful partial capability", async () => {
    const response = await request(createApp())
      .post(`/api/admin/users/${encodeURIComponent(subject)}/force-sign-out`)
      .set("Authorization", "Bearer owner")
      .send({ action: "force-sign-out", confirmation, target })
      .expect(200);

    expect(response.body.status).toBe("partial");
    expect(response.body.auth0.sessions).toBe("unavailable");
    expect(users.forceSignOutFerryUser).toHaveBeenCalledWith(subject);
  });

  it("never invokes sign-out if confirmation belongs to another user", async () => {
    await request(createApp())
      .post(`/api/admin/users/${encodeURIComponent(subject)}/force-sign-out`)
      .set("Authorization", "Bearer owner")
      .send({
        action: "force-sign-out",
        confirmation,
        target: "user:auth0|other",
      })
      .expect(400);

    expect(users.forceSignOutFerryUser).not.toHaveBeenCalled();
  });
});
