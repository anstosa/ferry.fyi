import express, { Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { wrapApiResponse } from "../../server/controllers/api";
import { sendResponse } from "../../server/lib/api";
import {
  apiErrorHandler,
  apiNotFound,
  classifyApiRequest,
  createApiCorsMiddleware,
  denyUntrustedSensitivePreflight,
} from "../../server/lib/httpApiPolicy";
import { getWsfStatus } from "../../server/lib/wsf/api";
import { createApp } from "../../server/server";

// api seam
describe("sendResponse", () => {
  // response envelope
  it("wraps response bodies with WSF status", () => {
    const send = vi.fn();
    const response = { send } as unknown as Response;
    const body = { ok: true };

    sendResponse(response, body);

    expect(send).toHaveBeenCalledWith({
      body,
      wsfStatus: getWsfStatus(),
    });
  });
});

// api router envelope
describe("wrapApiResponse", () => {
  // send envelope
  it("wraps send object bodies with WSF status", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.get("/send", (request, response) => {
      return response.send({ ok: true });
    });

    const response = await request(app).get("/send").expect(200);

    expect(response.body).toEqual({
      body: { ok: true },
      wsfStatus: getWsfStatus(),
    });
  });

  // json envelope
  it("wraps json object bodies with WSF status", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.get("/json", (request, response) => {
      return response.json({ ok: true });
    });

    const response = await request(app).get("/json").expect(200);

    expect(response.body).toEqual({
      body: { ok: true },
      wsfStatus: getWsfStatus(),
    });
  });

  it("normalizes an empty resource 404 without changing the envelope", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.get("/resource", (_request, response) => response.status(404).send());

    const response = await request(app).get("/resource").expect(404);

    expect(response.body).toEqual({
      body: { error: "resource_not_found" },
      wsfStatus: getWsfStatus(),
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, noarchive");
  });

  it("isolates unknown and thrown API failures as JSON", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.get("/throw", () => {
      throw new Error("private raw error");
    });
    app.use(apiNotFound);
    app.use(apiErrorHandler);

    const unknown = await request(app).get("/unknown").expect(404);
    expect(unknown.body.body).toEqual({ error: "api_not_found" });
    expect(unknown.type).toBe("application/json");

    const thrown = await request(app).get("/throw").expect(500);
    expect(thrown.body.body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(thrown.body)).not.toContain("private raw error");
  });

  it("normalizes bearer failures and preserves the challenge", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.get("/auth", (_request, _response, next) =>
      next({
        headers: { "WWW-Authenticate": 'Bearer realm="ferry"' },
        message: "provider detail",
        status: 401,
      })
    );
    app.use(apiErrorHandler);

    const response = await request(app).get("/auth").expect(401);
    expect(response.body.body).toEqual({ error: "unauthorized" });
    expect(response.headers["www-authenticate"]).toBe('Bearer realm="ferry"');
    expect(JSON.stringify(response.body)).not.toContain("provider detail");
  });
});

describe("full API error boundary", () => {
  it("keeps body-parser failures in the JSON envelope", async () => {
    const api = express.Router();
    api.post("/echo", (apiRequest, response) => response.json(apiRequest.body));
    const fallback = express
      .Router()
      .use((_request, response) => response.sendStatus(404));
    const app = createApp({ apiHandler: api, staticHandler: fallback });

    const malformed = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .send('{"incomplete":')
      .expect(400);

    expect(malformed.type).toBe("application/json");
    expect(malformed.body.body).toEqual({ error: "invalid_request" });
    expect(malformed.headers["cache-control"]).toBe("no-store");
    expect(malformed.headers["x-robots-tag"]).toBe("noindex, noarchive");
  });

  it("keeps OTA body-parser failures outside the API envelope", async () => {
    const fallback = express
      .Router()
      .use((_request, response) => response.sendStatus(404));
    const app = createApp({
      apiHandler: express.Router(),
      staticHandler: fallback,
    });

    const malformed = await request(app)
      .post("/api/ota/manifest")
      .set("Content-Type", "application/json")
      .send('{"incomplete":')
      .expect(400);

    expect(malformed.body).toEqual({ error: "invalid_request" });
  });
});

describe("API route policy", () => {
  it.each([
    ["POST", "/api/schedule/7/3", "anonymous-read"],
    ["POST", "/api/vessels/refresh", "upstream-refresh"],
    ["GET", "/api/tickets/example", "sensitive-lookup"],
    ["GET", "/api/user", "authenticated"],
    ["GET", "/api/ota/channel", "ota"],
    ["GET", "/api/ads", "anonymous-read"],
    ["POST", "/api/ads/exposures", "ad-measurement"],
    ["POST", "/api/ads/measure", "ad-measurement"],
    ["POST", "/api/ads/click", "ad-measurement"],
  ])("classifies %s %s", (method, pathname, expected) => {
    expect(classifyApiRequest({ method, pathname })).toBe(expected);
  });

  it("preserves wildcard public CORS and originless native access", async () => {
    const app = express();
    app.use(createApiCorsMiddleware());
    app.use(denyUntrustedSensitivePreflight);
    app.get("/api/features", (_request, response) => response.sendStatus(204));
    app.get("/api/user", (_request, response) => response.sendStatus(204));

    const publicResponse = await request(app)
      .get("/api/features")
      .set("Origin", "https://crawler.example")
      .expect(204);
    expect(publicResponse.headers["access-control-allow-origin"]).toBe("*");

    await request(app).get("/api/user").expect(204);
  });

  it("rejects an untrusted sensitive preflight", async () => {
    const app = express();
    app.use(wrapApiResponse);
    app.use(createApiCorsMiddleware());
    app.use(denyUntrustedSensitivePreflight);

    const response = await request(app)
      .options("/api/user")
      .set("Origin", "https://untrusted.example")
      .set("Access-Control-Request-Method", "GET")
      .expect(403);
    expect(response.body.body).toEqual({ error: "origin_not_allowed" });
  });
});
