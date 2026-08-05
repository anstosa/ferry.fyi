import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  claimAdExposure: vi.fn(),
  issueAdExposure: vi.fn(),
  resolveAdClick: vi.fn(),
}));
vi.mock("~/services/public/adTracking", () => tracking);

import { adsRouter } from "../../server/controllers/api/ads";

describe("public ads route", () => {
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
});
