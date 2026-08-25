import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supporter = vi.hoisted(() => ({
  createSupporterManagementLink: vi.fn(),
  getSupporterStatus: vi.fn(),
  reconcileSupporterSubject: vi.fn(),
  setSupporterAdsEnabled: vi.fn(),
  SupporterAuthorizationError: class extends Error {},
  SupporterRateLimitError: class extends Error {},
}));

vi.mock("~/lib/supporter", () => supporter);

import { supporterRouter } from "../../server/controllers/api/supporter";

// create one authenticated supporter route harness
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.locals.user = { iat: 1_777_777_777, sub: "auth0|supporter" };
    next();
  });
  app.use("/supporter", supporterRouter);
  return app;
};

describe("supporter route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supporter.setSupporterAdsEnabled.mockResolvedValue({
      active: true,
      adsEnabled: true,
    });
  });

  // persist one valid supporter ad preference
  it("updates the authenticated account's ad preference", async () => {
    const response = await request(createApp())
      .put("/supporter/preferences")
      .send({ adsEnabled: true })
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(supporter.setSupporterAdsEnabled).toHaveBeenCalledWith(
      "auth0|supporter",
      1_777_777_777,
      true
    );
    expect(response.body).toEqual({ active: true, adsEnabled: true });
  });

  // reject ambiguous preference payloads
  it("rejects a non-boolean ad preference", async () => {
    await request(createApp())
      .put("/supporter/preferences")
      .send({ adsEnabled: "yes" })
      .expect(400, { error: "invalid_request" });

    expect(supporter.setSupporterAdsEnabled).not.toHaveBeenCalled();
  });
});
