import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));
vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/terminalLocations", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../server/lib/terminalLocations")
  >()),
  terminalLocationService: service,
}));
vi.mock("express-oauth2-jwt-bearer", () => ({
  // emulate the existing jwt boundary without live identity requests
  auth:
    () =>
    (
      req: Request & { auth?: { payload: { sub: string } } },
      res: Response,
      next: NextFunction
    ) => {
      const identity = req.get("authorization");
      // deny anonymous requests before the owner router
      if (!identity) {
        res.status(401).send({ error: "Unauthorized" });
        return;
      }
      req.auth = {
        payload: {
          sub: identity === "Bearer owner" ? "auth0|owner" : "auth0|other",
        },
      };
      next();
    },
}));

import {
  adminRouter,
  preventAdminCaching,
} from "../../../server/controllers/api/admin";
import { clearOwnerAdminVerificationCache } from "../../../server/controllers/api/admin/authorization";
import { requireAuth } from "../../../server/controllers/api/auth";
import { TerminalLocationValidationError } from "../../../server/lib/terminalLocations";

// exercise the sole privileged composition root
const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", preventAdminCaching, requireAuth, adminRouter);
  return app;
};
const action = "save-terminal-locations";
const target = "terminal:7";
const points = { booth: { latitude: 47.6, longitude: -122.33 }, dock: null };
const payload = {
  ...points,
  action,
  target,
  confirmation: getAdminConfirmationPhrase(action, target),
};

describe("owner terminal locations routes", () => {
  // reset identity and persistence doubles for each request
  beforeEach(() => {
    vi.clearAllMocks();
    clearOwnerAdminVerificationCache();
    auth0.getAuth0UserEmail.mockImplementation(async (id: string) =>
      id === "auth0|owner" ? "anstosa@gmail.com" : "other@example.com"
    );
    service.list.mockResolvedValue({ terminals: [] });
    service.save.mockResolvedValue({ terminalId: "7", ...points });
  });

  // deny both read and mutation outside owner authorization
  it.each([undefined, "Bearer other"])(
    "rejects unauthorized reads and writes %s",
    async (token) => {
      const app = createApp();
      // test both privileged operations through the root
      for (const method of ["get", "put"] as const) {
        const call = request(app)[method]("/api/admin/terminal-locations/7");
        // supply synthetic identity only when present
        if (token) call.set("Authorization", token);
        const response = await call.send(payload);
        expect(response.status).toBe(token ? 403 : 401);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      expect(service.list).not.toHaveBeenCalled();
      expect(service.save).not.toHaveBeenCalled();
    }
  );

  // return owner-only editable records without caching
  it("lists terminal points for the owner", async () => {
    const response = await request(createApp())
      .get("/api/admin/terminal-locations")
      .set("Authorization", "Bearer owner")
      .expect(200);
    expect(response.body).toEqual({ terminals: [] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  // strip verified metadata before strict domain validation
  it("saves confirmed points for the route-derived terminal", async () => {
    await request(createApp())
      .put("/api/admin/terminal-locations/7")
      .set("Authorization", "Bearer owner")
      .send(payload)
      .expect(200);
    expect(service.save).toHaveBeenCalledWith("7", points);
  });

  // mismatched confirmation never invokes persistence
  it.each([
    { ...payload, confirmation: undefined },
    { ...payload, target: "terminal:3" },
    { ...payload, action: "save-site-settings" },
  ])("rejects unconfirmed mutations %j", async (body) => {
    await request(createApp())
      .put("/api/admin/terminal-locations/7")
      .set("Authorization", "Bearer owner")
      .send(body)
      .expect(400);
    expect(service.save).not.toHaveBeenCalled();
  });

  // preserve bounded validation errors while hiding database diagnostics
  it("reports validation and storage failures safely", async () => {
    service.save.mockRejectedValueOnce(
      new TerminalLocationValidationError("Invalid terminal locations")
    );
    const invalid = await request(createApp())
      .put("/api/admin/terminal-locations/7")
      .set("Authorization", "Bearer owner")
      .send(payload)
      .expect(400);
    expect(invalid.body).toEqual({ error: "Invalid terminal locations" });
    service.save.mockRejectedValueOnce(new Error("postgres details secret"));
    const failed = await request(createApp())
      .put("/api/admin/terminal-locations/7")
      .set("Authorization", "Bearer owner")
      .send(payload)
      .expect(503);
    expect(failed.body).toEqual({
      error: "Terminal locations could not be saved",
    });
    service.list.mockRejectedValueOnce(new Error("postgres details secret"));
    const unavailable = await request(createApp())
      .get("/api/admin/terminal-locations")
      .set("Authorization", "Bearer owner")
      .expect(503);
    expect(unavailable.body).toEqual({
      error: "Terminal locations unavailable",
    });
  });
});
