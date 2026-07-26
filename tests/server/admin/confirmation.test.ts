import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";

const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));

vi.mock("~/lib/auth0Admin", () => auth0);
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

describe("admin typed confirmation", () => {
  const action = "test-safe-mutation" as const;
  const target = "fixture:confirmation";
  const phrase = getAdminConfirmationPhrase(action, target)!;

  beforeEach(() => {
    auth0.getAuth0UserEmail.mockReset();
    auth0.getAuth0UserEmail.mockResolvedValue("anstosa@gmail.com");
  });

  it("derives a stable phrase only for a canonical target", () => {
    expect(phrase).toBe("CONFIRM test-safe-mutation fixture:confirmation");
    expect(getAdminConfirmationPhrase(action, " fixture:confirmation")).toBe(
      undefined
    );
  });

  it("allows the test-only guarded action with its server-derived phrase", async () => {
    const response = await request(createApp())
      .post("/api/admin/__test/confirmed-safe-action")
      .set("Authorization", "Bearer owner")
      .send({ action, confirmation: phrase, target })
      .expect(200);

    expect(response.body).toEqual({
      confirmationRemoved: true,
      confirmed: true,
    });
  });

  it.each([
    [undefined, "missing body"],
    [{ action, target }, "missing phrase"],
    [{ action, confirmation: phrase, target: "fixture:other" }, "wrong target"],
    [{ action, confirmation: phrase, target: "fixture: confirmation" }, "malformed target"],
    [{ action: "delete-user-data", confirmation: phrase, target }, "wrong action"],
    [{ action, confirmation: "CONFIRM something else", target }, "wrong phrase"],
  ])("rejects %s", async (payload) => {
    const response = await request(createApp())
      .post("/api/admin/__test/confirmed-safe-action")
      .set("Authorization", "Bearer owner")
      .send(payload)
      .expect(400);

    expect(response.body).toEqual({ error: "Invalid typed confirmation" });
  });
});
