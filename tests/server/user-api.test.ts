import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assignAuthUser,
  assignOptionalAuthUser,
  requireAuth,
} from "../../server/controllers/api/auth";
import {
  sanitizeUserUpdate,
  userRouter,
} from "../../server/controllers/api/user";

const userSettings = vi.hoisted(() => ({
  findOrCreate: vi.fn(),
}));
const ticketCache = vi.hoisted(() => ({
  deleteUnsavedUserTickets: vi.fn(),
}));
const revocation = vi.hoisted(() => ({
  isApplicationTokenRevoked: vi.fn(),
}));

vi.mock("~/models/UserSettings", () => ({
  UserSettings: userSettings,
}));
vi.mock("~/lib/wsf/userTicketCache", () => ticketCache);
vi.mock("~/lib/admin/sessionRevocation", () => revocation);

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

// user settings fixture
const makeSettings = (appMetadata = {}, favoriteRouteIds: string[] = []) => {
  const settings = {
    appMetadata,
    favoriteRouteIds,
    subject: "auth0|123",
    // update settings fixture
    update: vi.fn(
      (data: {
        appMetadata: Record<string, unknown>;
        favoriteRouteIds?: string[];
      }) => {
        settings.appMetadata = data.appMetadata;
        settings.favoriteRouteIds =
          data.favoriteRouteIds ?? settings.favoriteRouteIds;
        return Promise.resolve(settings);
      }
    ),
  };
  return settings;
};

// create test app
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/user", requireAuth, assignAuthUser, userRouter);
  return app;
};

// protected user api

describe("user API", () => {
  beforeEach(() => {
    userSettings.findOrCreate.mockReset();
    ticketCache.deleteUnsavedUserTickets
      .mockReset()
      .mockResolvedValue(undefined);
    revocation.isApplicationTokenRevoked.mockReset().mockResolvedValue(false);
  });

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

    expect(response.body).toEqual({ error: "unauthorized" });
  });

  // current user case
  it("returns the current DB-backed app metadata", async () => {
    const settings = makeSettings({ tickets: ["abc"] }, ["3", "9"]);
    userSettings.findOrCreate.mockResolvedValueOnce([settings, false]);
    const app = createApp();

    const response = await request(app)
      .get("/api/user")
      .set("Authorization", "Bearer valid")
      .expect(200);

    expect(userSettings.findOrCreate).toHaveBeenCalledWith({
      defaults: {
        appMetadata: {},
        favoriteRouteIds: [],
        subject: "auth0|123",
      },
      where: { subject: "auth0|123" },
    });
    expect(response.body).toEqual({
      app_metadata: { tickets: ["abc"] },
      favoriteRouteIds: ["3", "9"],
      user_id: "auth0|123",
    });
  }, 15_000);

  // stored alert conversion case
  it("converts old saved alerts on read", async () => {
    const settings = makeSettings({
      alertSubscriptions: { "5:14": ["delays"] },
      subscribedTerminals: ["14"],
      tickets: ["abc"],
    });
    userSettings.findOrCreate.mockResolvedValueOnce([settings, false]);
    const app = createApp();

    const response = await request(app)
      .get("/api/user")
      .set("Authorization", "Bearer valid")
      .expect(200);

    expect(settings.update).toHaveBeenCalledWith({
      appMetadata: {
        alertRules: [
          {
            channels: ["delays"],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "route-alert:14:5",
            routeKey: "14:5",
            startTime: "00:00",
            terminalIds: ["5", "14"],
          },
          {
            channels: [
              "delays",
              "cancellations",
              "sailing-updates",
              "wait-times",
              "service-alerts",
            ],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "terminal-alert:14:14:5",
            routeKey: "14:5",
            startTime: "00:00",
            terminalIds: ["14"],
          },
        ],
        tickets: ["abc"],
      },
    });
    expect(response.body).toEqual({
      app_metadata: settings.update.mock.calls[0][0].appMetadata,
      favoriteRouteIds: [],
      user_id: "auth0|123",
    });
  });

  // update allow-list case
  it("updates only allowed app metadata fields in the DB", async () => {
    const settings = makeSettings({ subscribedTerminals: ["14"] });
    userSettings.findOrCreate.mockResolvedValueOnce([settings, false]);
    const app = createApp();

    const response = await request(app)
      .post("/api/user")
      .set("Authorization", "Bearer valid")
      .send({
        app_metadata: {
          alertRules: [
            {
              channels: ["delays", "bad-channel"],
              date: "2026-07-06",
              daysOfWeek: [5, 1],
              endTime: "07:30",
              id: "morning",
              routeKey: "14:5",
              startTime: "06:00",
              terminalIds: ["14", "bad"],
            },
            { bad: true },
          ],
          alertSubscriptions: {
            "5:14": ["delays", "cancellations", "bad-channel"],
            bad: "not-array",
          },
          blocked: true,
          favoriteRouteIds: ["ignored"],
          fcmToken: "token",
          tickets: ["abc"],
        },
        blocked: true,
        email: "attacker@example.com",
        favoriteRouteIds: ["9", "3", "9"],
        user_metadata: { isAuthenticated: false },
      })
      .expect(200);

    expect(settings.update).toHaveBeenCalledWith({
      appMetadata: {
        alertRules: [
          {
            channels: ["delays"],
            date: "2026-07-06",
            daysOfWeek: [1, 5],
            endTime: "07:30",
            id: "morning",
            routeKey: "14:5",
            startTime: "06:00",
            terminalIds: ["14"],
          },
          {
            channels: ["delays", "cancellations"],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "route-alert:14:5",
            routeKey: "14:5",
            startTime: "00:00",
            terminalIds: ["5", "14"],
          },
        ],
        fcmToken: "token",
        tickets: ["abc"],
      },
      favoriteRouteIds: ["3", "9"],
    });
    expect(response.body).toEqual({
      app_metadata: {
        alertRules: [
          {
            channels: ["delays"],
            date: "2026-07-06",
            daysOfWeek: [1, 5],
            endTime: "07:30",
            id: "morning",
            routeKey: "14:5",
            startTime: "06:00",
            terminalIds: ["14"],
          },
          {
            channels: ["delays", "cancellations"],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "route-alert:14:5",
            routeKey: "14:5",
            startTime: "00:00",
            terminalIds: ["5", "14"],
          },
        ],
        fcmToken: "token",
        tickets: ["abc"],
      },
      favoriteRouteIds: ["3", "9"],
      user_id: "auth0|123",
    });
    expect(ticketCache.deleteUnsavedUserTickets).toHaveBeenCalledWith(
      "auth0|123",
      ["abc"]
    );
  });
});

describe("optional API authentication", () => {
  // reset revocation behavior
  beforeEach(() => {
    revocation.isApplicationTokenRevoked.mockReset().mockResolvedValue(false);
  });

  // create optional auth harness
  const createOptionalApp = (): express.Express => {
    const app = express();
    app.use(assignOptionalAuthUser);
    app.get("/", (_request, response) =>
      response.send({ subject: response.locals.user?.sub ?? null })
    );
    return app;
  };

  it("continues anonymously when no bearer token is supplied", async () => {
    await request(createOptionalApp()).get("/").expect(200, { subject: null });
  });

  it("assigns the validated subject when a bearer token is supplied", async () => {
    await request(createOptionalApp())
      .get("/")
      .set("Authorization", "Bearer valid")
      .expect(200, { subject: "auth0|123" });
  });

  // invalid bearer rejection
  it("rejects an invalid bearer token", async () => {
    await request(createOptionalApp())
      .get("/")
      .set("Authorization", "Bearer invalid")
      .expect(401, { error: "Unauthorized" });
  });

  // missing subject fallback
  it("continues anonymously when a validated token has no subject", async () => {
    await request(createOptionalApp())
      .get("/")
      .set("Authorization", "Bearer no-sub")
      .expect(200, { subject: null });
  });

  // revoked bearer rejection
  it("rejects a revoked optional bearer token", async () => {
    revocation.isApplicationTokenRevoked.mockResolvedValueOnce(true);

    await request(createOptionalApp())
      .get("/")
      .set("Authorization", "Bearer valid")
      .expect(401, { error: "unauthorized" });
  });

  // revocation error propagation
  it("propagates revocation lookup errors", async () => {
    revocation.isApplicationTokenRevoked.mockRejectedValueOnce(
      new Error("revocation unavailable")
    );

    await request(createOptionalApp())
      .get("/")
      .set("Authorization", "Bearer valid")
      .expect(500);
  });
});

// update sanitizer

describe("sanitizeUserUpdate", () => {
  // top-level allow-list case
  it("drops privileged top-level Auth0 fields", () => {
    expect(
      sanitizeUserUpdate({
        app_metadata: {
          alertRules: [
            {
              channels: ["service-alerts"],
              daysOfWeek: [1, 2, 3, 4, 5],
              endTime: "17:00",
              id: "afternoon",
              routeKey: "bre:sea",
              startTime: "15:30",
              terminalIds: ["sea"],
            },
          ],
          alertSubscriptions: { "sea:bre": ["service-alerts"] },
          subscribedTerminals: ["sea"],
        },
        blocked: true,
        email: "attacker@example.com",
        favoriteRouteIds: ["9", "3", "9"],
        user_metadata: { isAuthenticated: false },
      })
    ).toEqual({
      app_metadata: {
        alertRules: [
          {
            channels: ["service-alerts"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "17:00",
            id: "afternoon",
            routeKey: "bre:sea",
            startTime: "15:30",
            terminalIds: ["sea"],
          },
          {
            channels: ["service-alerts"],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "route-alert:bre:sea",
            routeKey: "bre:sea",
            startTime: "00:00",
            terminalIds: ["sea", "bre"],
          },
          {
            channels: [
              "delays",
              "cancellations",
              "sailing-updates",
              "wait-times",
              "service-alerts",
            ],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            endTime: "24:00",
            id: "terminal-alert:sea:sea",
            routeKey: "sea",
            startTime: "00:00",
            terminalIds: ["sea"],
          },
        ],
      },
      favoriteRouteIds: ["3", "9"],
    });
  });
});
