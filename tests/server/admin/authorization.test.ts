import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth0 = vi.hoisted(() => ({
  getAuth0UserEmail: vi.fn(),
  getAuth0UserInfo: vi.fn(),
}));
const flags = vi.hoisted(() => ({
  getLeaderboardFlags: vi.fn(),
  setAutomaticLeaderboardCheckinsEnabled: vi.fn(),
  setLeaderboardsEnabled: vi.fn(),
}));

vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/leaderboardFlags", () => flags);
vi.mock("express-oauth2-jwt-bearer", () => ({
  auth:
    () =>
    (
      expressRequest: Request & {
        auth?: { payload: { sub?: string }; token: string };
      },
      response: Response,
      next: NextFunction
    ): void => {
      switch (expressRequest.get("authorization")) {
        case "Bearer owner":
          expressRequest.auth = {
            payload: { sub: "auth0|owner" },
            token: "owner-token",
          };
          next();
          return;
        case "Bearer non-owner":
          expressRequest.auth = {
            payload: { sub: "auth0|other" },
            token: "non-owner-token",
          };
          next();
          return;
        case "Bearer no-sub":
          expressRequest.auth = { payload: {}, token: "no-sub-token" };
          next();
          return;
        default:
          response.status(401).send({ error: "Unauthorized" });
      }
    },
}));

import {
  adminRouter,
  preventAdminCaching,
} from "../../../server/controllers/api/admin";
import { requireAuth } from "../../../server/controllers/api/auth";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", preventAdminCaching, requireAuth, adminRouter);
  return app;
};

describe("owner admin authorization", () => {
  beforeEach(() => {
    auth0.getAuth0UserEmail.mockReset();
    auth0.getAuth0UserInfo
      .mockReset()
      .mockRejectedValue(new Error("User info unavailable"));
    flags.getLeaderboardFlags.mockReset().mockResolvedValue({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: false,
    });
    flags.setAutomaticLeaderboardCheckinsEnabled.mockReset().mockResolvedValue(false);
    flags.setLeaderboardsEnabled.mockReset().mockResolvedValue(false);
  });

  it("rejects an unauthenticated request before the admin root", async () => {
    const response = await request(createApp())
      .get("/api/admin/features")
      .expect(401);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(auth0.getAuth0UserEmail).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-owner", async () => {
    auth0.getAuth0UserEmail.mockResolvedValueOnce("other@example.com");

    const response = await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer non-owner")
      .expect(403);

    expect(response.body).toEqual({ error: "Administrator access required" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(auth0.getAuth0UserEmail).toHaveBeenCalledWith("auth0|other");
  });

  it.each([
    "/api/admin/users/auth0%7Cperson",
    "/api/admin/operations/",
    "/api/admin/notifications/",
    "/api/admin/content/",
  ])("rejects a non-owner before entering %s", async (path) => {
    auth0.getAuth0UserEmail.mockResolvedValueOnce("other@example.com");

    const response = await request(createApp())
      .get(path)
      .set("Authorization", "Bearer non-owner")
      .expect(403);

    expect(response.body).toEqual({ error: "Administrator access required" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects malformed authenticated claims without looking up Auth0", async () => {
    const response = await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer no-sub")
      .expect(401);

    expect(response.body).toEqual({ error: "Missing authenticated subject" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(auth0.getAuth0UserEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the owner lookup is unavailable", async () => {
    auth0.getAuth0UserEmail.mockRejectedValueOnce(
      new Error("Auth0 unavailable")
    );

    const response = await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .expect(403);

    expect(response.body).toEqual({ error: "Administrator access required" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("allows the owner to retain the current feature endpoint behavior", async () => {
    auth0.getAuth0UserEmail.mockResolvedValueOnce("ANSTOSA@gmail.com");

    const response = await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .expect(200);

    expect(response.body).toEqual({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: false,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("authorizes the matching owner token without Management API access", async () => {
    auth0.getAuth0UserInfo.mockResolvedValueOnce({
      email: "ANSTOSA@gmail.com",
      subject: "auth0|owner",
    });

    await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .expect(200);

    expect(auth0.getAuth0UserInfo).toHaveBeenCalledWith("owner-token");
    expect(auth0.getAuth0UserEmail).not.toHaveBeenCalled();
  });

  it("rejects user info that does not match the validated token subject", async () => {
    auth0.getAuth0UserInfo.mockResolvedValueOnce({
      email: "anstosa@gmail.com",
      subject: "auth0|someone-else",
    });

    await request(createApp())
      .get("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .expect(403);

    expect(auth0.getAuth0UserEmail).not.toHaveBeenCalled();
  });
  it("rejects attempts to enable automatic check-ins while allowing leaderboard updates", async () => {
    auth0.getAuth0UserEmail.mockResolvedValue("anstosa@gmail.com");

    await request(createApp())
      .put("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .send({ automaticLeaderboardCheckinsEnabled: true, leaderboardsEnabled: true })
      .expect(400);

    expect(flags.setAutomaticLeaderboardCheckinsEnabled).not.toHaveBeenCalled();

    const response = await request(createApp())
      .put("/api/admin/features")
      .set("Authorization", "Bearer owner")
      .send({ leaderboardsEnabled: true })
      .expect(200);

    expect(response.body).toEqual({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: false,
    });
    expect(flags.setAutomaticLeaderboardCheckinsEnabled).toHaveBeenCalledWith(false);
    expect(flags.setLeaderboardsEnabled).toHaveBeenCalledWith(true);
  });

});
