import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { assignAuthUser, requireAuth } from "../../server/controllers/api/auth";
import {
  sanitizeUserUpdate,
  userRouter,
} from "../../server/controllers/api/user";

const auth0Users = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("~/lib/auth0", () => ({
  auth0: { users: auth0Users },
}));

vi.mock("~/lib/wsf/api", () => ({
  getWsfStatus: () => {
    return { offline: false };
  },
}));

vi.mock("express-oauth2-jwt-bearer", () => ({
  auth:
    () =>
    (
      expressRequest: Request & { auth?: { payload: { sub?: string } } },
      response: Response,
      next: NextFunction
    ): void => {
      const authorization = expressRequest.get("authorization");
      // valid token fixture
      if (authorization === "Bearer valid") {
        expressRequest.auth = { payload: { sub: "auth0|123" } };
        next();
        return;
      }
      // missing subject fixture
      if (authorization === "Bearer no-sub") {
        expressRequest.auth = { payload: {} };
        next();
        return;
      }
      response.status(401).send({ error: "Unauthorized" });
    },
}));

// create test app
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/user", requireAuth, assignAuthUser, userRouter);
  return app;
};

// protected user api

describe("user API", () => {
  // missing token case
  it("rejects requests without a token", async () => {
    const app = createApp();

    await request(app).get("/api/user").expect(401);
  });

  // missing subject case
  it("rejects tokens without a subject", async () => {
    const app = createApp();

    const response = await request(app)
      .get("/api/user")
      .set("Authorization", "Bearer no-sub")
      .expect(401);

    expect(response.body).toEqual({
      error: "Missing authenticated subject",
    });
  });

  // current user case
  it("returns the current Auth0 user", async () => {
    auth0Users.get.mockResolvedValueOnce({
      data: { app_metadata: { tickets: ["abc"] }, user_id: "auth0|123" },
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/user")
      .set("Authorization", "Bearer valid")
      .expect(200);

    expect(auth0Users.get).toHaveBeenCalledWith("auth0|123");
    expect(response.body).toEqual({
      app_metadata: { tickets: ["abc"] },
      user_id: "auth0|123",
    });
  });

  // direct SDK response case
  it("returns current Auth0 users from direct SDK response bodies", async () => {
    auth0Users.get.mockResolvedValueOnce({
      app_metadata: { tickets: ["abc"] },
      user_id: "auth0|123",
    });
    const app = createApp();

    const response = await request(app)
      .get("/api/user")
      .set("Authorization", "Bearer valid")
      .expect(200);

    expect(response.body).toEqual({
      app_metadata: { tickets: ["abc"] },
      user_id: "auth0|123",
    });
  });

  // update allow-list case
  it("updates only the allowed Auth0 metadata fields", async () => {
    auth0Users.update.mockResolvedValueOnce({
      data: {
        app_metadata: { fcmToken: "token", tickets: ["abc"] },
        user_id: "auth0|123",
      },
    });
    const app = createApp();

    const response = await request(app)
      .post("/api/user")
      .set("Authorization", "Bearer valid")
      .send({
        app_metadata: {
          alertSubscriptions: {
            "5:14": ["delays", "cancellations", "bad-channel"],
            bad: "not-array",
          },
          blocked: true,
          fcmToken: "token",
          tickets: ["abc"],
        },
        blocked: true,
        email: "attacker@example.com",
        user_metadata: { isAuthenticated: false },
      })
      .expect(200);

    expect(auth0Users.update).toHaveBeenCalledWith("auth0|123", {
      app_metadata: {
        alertSubscriptions: { "5:14": ["delays", "cancellations"] },
        fcmToken: "token",
        tickets: ["abc"],
      },
    });
    expect(response.body).toEqual({
      app_metadata: { fcmToken: "token", tickets: ["abc"] },
      user_id: "auth0|123",
    });
  });
});

// update sanitizer

describe("sanitizeUserUpdate", () => {
  // top-level allow-list case
  it("drops privileged top-level Auth0 fields", () => {
    expect(
      sanitizeUserUpdate({
        app_metadata: {
          alertSubscriptions: { "sea:bre": ["service-alerts"] },
          subscribedTerminals: ["sea"],
        },
        blocked: true,
        email: "attacker@example.com",
        user_metadata: { isAuthenticated: false },
      })
    ).toEqual({
      app_metadata: {
        alertSubscriptions: { "sea:bre": ["service-alerts"] },
        subscribedTerminals: ["sea"],
      },
    });
  });
});
