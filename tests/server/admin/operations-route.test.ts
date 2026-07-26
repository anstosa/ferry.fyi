import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  getAdminOperationStates: vi.fn(),
  isAdminOperationName: vi.fn((value: string) => value === "wsf-refresh" || value === "clear-wsf-memory-cache"),
  isDestructiveAdminOperation: vi.fn((value: string) => value === "clear-wsf-memory-cache"),
  runAdminOperation: vi.fn(),
}));
const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));

vi.mock("~/lib/admin/operations", () => operations);
vi.mock("~/lib/auth0Admin", () => auth0);

import { adminOperationsRouter } from "../../../server/controllers/api/admin/operations";
import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { requireOwnerAdmin } from "../../../server/controllers/api/admin/authorization";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((request: Request & { auth?: { payload: { sub: string } } }, _response: Response, next: NextFunction) => {
    request.auth = { payload: { sub: "auth0|owner" } };
    next();
  });
  app.use("/api/admin/operations", requireOwnerAdmin, adminOperationsRouter);
  return app;
};

describe("owner admin operations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth0.getAuth0UserEmail.mockResolvedValue("anstosa@gmail.com");
    operations.getAdminOperationStates.mockResolvedValue([]);
    operations.runAdminOperation.mockResolvedValue({
      operation: { operation: "wsf-refresh", status: "succeeded" },
      started: true,
    });
  });

  it("requires the operation-bound typed confirmation before triggering", async () => {
    await request(createApp())
      .post("/api/admin/operations/wsf-refresh/run")
      .send({})
      .expect(400);
    expect(operations.runAdminOperation).not.toHaveBeenCalled();

    const target = "operation:wsf-refresh";
    await request(createApp())
      .post("/api/admin/operations/wsf-refresh/run")
      .send({
        action: "run-operation",
        confirmation: getAdminConfirmationPhrase("run-operation", target),
        target,
      })
      .expect(200);
    expect(operations.runAdminOperation).toHaveBeenCalledWith("wsf-refresh");
  });

  it("rejects unknown operation names rather than accepting command input", async () => {
    await request(createApp())
      .post("/api/admin/operations/sh%20-c%20whoami/run")
      .send({})
      .expect(404);
    expect(operations.runAdminOperation).not.toHaveBeenCalled();
  });

  it("blocks non-owner callers before operation status or execution", async () => {
    auth0.getAuth0UserEmail.mockResolvedValue("not-owner@example.com");

    await request(createApp()).get("/api/admin/operations/").expect(403);
    expect(operations.getAdminOperationStates).not.toHaveBeenCalled();
  });
});
