import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  claimAdExposure: vi.fn(),
  issueAdExposure: vi.fn(),
  resolveAdClick: vi.fn(),
}));
const supporter = vi.hoisted(() => ({
  getSupporterSummaryForSubject: vi.fn(),
}));
vi.mock("~/services/public/adTracking", () => tracking);
vi.mock("~/lib/supporter", () => supporter);

import { adsRouter } from "../../server/controllers/api/ads";

describe("public ads route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supporter.getSupporterSummaryForSubject.mockResolvedValue({
      active: false,
      adsEnabled: false,
    });
  });

  it("issues a no-store exposure for a canonical placement", async () => {
    tracking.issueAdExposure.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_example",
    });
    const app = express();
    app.use(express.json());
    app.use("/ads", adsRouter);

    const response = await request(app)
      .post("/ads/exposures")
      .send({ placementKey: "schedule--3--7" })
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(tracking.issueAdExposure).toHaveBeenCalledWith("schedule--3--7");
  });

  it("accepts the browser origin forwarded by split local development", async () => {
    tracking.issueAdExposure.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_example",
    });
    const app = express();
    app.use(express.json());
    app.use("/ads", adsRouter);

    await request(app)
      .post("/ads/exposures")
      .set("Host", "server:4040")
      .set("Origin", "http://localhost:4040")
      .send({ placementKey: "home" })
      .expect(200);
  });

  it("accepts idempotent measurement claims without returning nonce state", async () => {
    const app = express();
    app.use(express.json());
    app.use("/ads", adsRouter);

    await request(app)
      .post("/ads/measure")
      .send({ event: "viewable", token: "adx_example" })
      .expect(204);

    expect(tracking.claimAdExposure).toHaveBeenCalledWith(
      "adx_example",
      "viewable"
    );
  });

  it("returns only the persisted native click destination", async () => {
    tracking.resolveAdClick.mockResolvedValue("https://example.com/offer");
    const app = express();
    app.use(express.json());
    app.use("/ads", adsRouter);

    await request(app)
      .post("/ads/click")
      .send({ campaignId: "campaign", token: "adx_example" })
      .expect(200, { targetUrl: "https://example.com/offer" });
  });

  // suppress paid-account ads unless the supporter opts in
  it("honors the active supporter's ad preference", async () => {
    tracking.issueAdExposure.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_example",
    });
    const app = express();
    app.use(express.json());
    app.use((_request, response, next) => {
      response.locals.user = { sub: "auth0|supporter" };
      next();
    });
    app.use("/ads", adsRouter);

    supporter.getSupporterSummaryForSubject.mockResolvedValueOnce({
      active: true,
      adsEnabled: false,
    });
    await request(app)
      .post("/ads/exposures")
      .send({ placementKey: "home" })
      .expect(200, { creative: null, expiresAt: null, token: null });
    expect(tracking.issueAdExposure).not.toHaveBeenCalled();

    supporter.getSupporterSummaryForSubject.mockResolvedValueOnce({
      active: true,
      adsEnabled: true,
    });
    await request(app)
      .post("/ads/exposures")
      .send({ placementKey: "home" })
      .expect(200);
    expect(tracking.issueAdExposure).toHaveBeenCalledWith("home");
  });
});
