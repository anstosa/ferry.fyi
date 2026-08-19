import { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://test:testing@localhost:5432/ferryfyi";
});

vi.mock("~/lib/admin/operations", () => ({
  runAdminOperation: vi.fn(),
}));
vi.mock("~/lib/db", async () => {
  const { Sequelize } = await import("sequelize");
  return {
    db: new Sequelize("postgres://test:testing@localhost:5432/ferryfyi", {
      logging: false,
    }),
    dbInit: Promise.resolve(),
  };
});

vi.mock("~/controllers/api", () => ({
  apiRouter: (_request: unknown, _response: unknown, next: () => void) =>
    next(),
  // bypass isolated native routing
  automaticLeaderboardNativeRouter: (
    _request: unknown,
    _response: unknown,
    next: () => void
  ) => next(),
}));

import { createApp } from "~/server";

const replyOn =
  (path: string, body: string): RequestHandler =>
  (request, response, next) =>
    request.path === path ? response.send(body) : next();

describe("development middleware composition", () => {
  it("trusts forwarded client addresses only from the local sidecar", () => {
    const app = createApp();
    const trustProxy = app.get("trust proxy fn") as (
      address: string
    ) => boolean;

    expect(trustProxy("127.0.0.1")).toBe(true);
    expect(trustProxy("::1")).toBe(true);
    expect(trustProxy("10.0.0.1")).toBe(false);
  });

  it("keeps API, policy, Vite, and static handling in that order", async () => {
    const app = createApp({
      apiHandler: replyOn("/ping", "api"),
      publicMiddleware: replyOn("/robots.txt", "policy"),
      staticHandler: (_request, response) => response.send("static"),
      webMiddleware: replyOn("/entry-client.tsx", "vite"),
    });

    await expect(request(app).get("/api/ping")).resolves.toMatchObject({
      status: 200,
      text: "api",
    });
    await expect(request(app).get("/robots.txt")).resolves.toMatchObject({
      status: 200,
      text: "policy",
    });
    await expect(request(app).get("/entry-client.tsx")).resolves.toMatchObject({
      status: 200,
      text: "vite",
    });
    await expect(request(app).get("/about")).resolves.toMatchObject({
      status: 200,
      text: "static",
    });
  });
});
