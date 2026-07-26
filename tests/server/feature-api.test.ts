import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({
  getFeatureFlagsForSubject: vi.fn(),
  getLeaderboardFlags: vi.fn(),
}));

vi.mock("~/lib/leaderboardFlags", () => flags);
vi.mock("express-oauth2-jwt-bearer", () => ({
  auth:
    () =>
    (
      req: Request & { auth?: { payload: { sub?: string } } },
      response: Response,
      next: NextFunction
    ): void => {
      if (req.get("authorization") === "Bearer tester") {
        req.auth = { payload: { sub: "auth0|tester" } };
        next();
        return;
      }
      response.status(401).send({ error: "Unauthorized" });
    },
}));

import { featureRouter } from "../../server/controllers/api/features";

const app = (): express.Express => {
  const server = express();
  server.use("/api/features", featureRouter);
  return server;
};

beforeEach(() => {
  flags.getLeaderboardFlags.mockResolvedValue({
    automaticLeaderboardCheckinsEnabled: false,
    leaderboardsEnabled: false,
  });
  flags.getFeatureFlagsForSubject.mockResolvedValue({
    automaticLeaderboardCheckinsEnabled: false,
    leaderboardsEnabled: true,
  });
});

describe("feature API delivery", () => {
  it("keeps anonymous feature delivery global-only", async () => {
    await request(app()).get("/api/features").expect(200).expect({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: false,
    });
    expect(flags.getLeaderboardFlags).toHaveBeenCalledOnce();
    expect(flags.getFeatureFlagsForSubject).not.toHaveBeenCalled();
  });

  it("requires a token for subject-aware flags", async () => {
    await request(app()).get("/api/features/me").expect(401);

    await request(app())
      .get("/api/features/me")
      .set("Authorization", "Bearer tester")
      .expect(200)
      .expect({
        automaticLeaderboardCheckinsEnabled: false,
        leaderboardsEnabled: true,
      });
    expect(flags.getFeatureFlagsForSubject).toHaveBeenCalledWith(
      "auth0|tester"
    );
  });
});
