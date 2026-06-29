import express, { Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { wrapApiResponse } from "../../server/controllers/api";
import { sendResponse } from "../../server/lib/api";
import { getWsfStatus } from "../../server/lib/wsf/api";

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
});
