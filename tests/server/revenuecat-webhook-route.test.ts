import { createHmac } from "node:crypto";

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supporter = vi.hoisted(() => ({
  ingestRevenueCatWebhook: vi.fn(),
  processRevenueCatWebhookEvent: vi.fn(),
}));

vi.mock("~/lib/supporter", () => supporter);
vi.mock("~/lib/logger", () => ({ default: { error: vi.fn() } }));

import { createRevenueCatWebhookRouter } from "../../server/controllers/revenueCatWebhook";

const AUTHORIZATION = "Bearer webhook-route-test";
const HMAC_SECRET = "webhook-route-hmac-test";

// sign one exact request body
const signBody = (body: string, timestamp: number): string => {
  const signature = createHmac("sha256", HMAC_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

// create one raw-body test app
const createApp = (limit = 120): express.Express => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(
    "/api/supporter/revenuecat/webhook",
    createRevenueCatWebhookRouter({ limit })
  );
  return app;
};

describe("RevenueCat webhook route", () => {
  // reset webhook test state
  beforeEach(() => {
    process.env.REVENUECAT_PRODUCTION_WEBHOOK_AUTHORIZATION = AUTHORIZATION;
    process.env.REVENUECAT_PRODUCTION_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
    process.env.REVENUECAT_SANDBOX_WEBHOOK_AUTHORIZATION = AUTHORIZATION;
    process.env.REVENUECAT_SANDBOX_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
    supporter.ingestRevenueCatWebhook.mockReset().mockResolvedValue({
      duplicate: false,
      eventId: "event-route-1",
    });
    supporter.processRevenueCatWebhookEvent
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("rejects unsigned webhook requests before persistence", async () => {
    await request(createApp())
      .post("/api/supporter/revenuecat/webhook/production")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(401);

    expect(supporter.ingestRevenueCatWebhook).not.toHaveBeenCalled();
  });

  // prove both routes bound traffic before body parsing
  it.each(["production", "sandbox"])(
    "rate-limits %s webhook attempts per source before parsing",
    async (environment) => {
      const app = createApp(1);
      const path = `/api/supporter/revenuecat/webhook/${environment}`;
      await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .set("X-Forwarded-For", "198.51.100.1")
        .send("{}")
        .expect(401);

      const response = await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .set("X-Forwarded-For", "198.51.100.1")
        .send("x".repeat(256 * 1_024 + 1))
        .expect(429);

      expect(response.body).toEqual({ error: "rate_limited" });
      await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .set("X-Forwarded-For", "198.51.100.2")
        .send("{}")
        .expect(401);
      expect(supporter.ingestRevenueCatWebhook).not.toHaveBeenCalled();
    }
  );

  it("persists a valid exact-byte webhook before acknowledgement", async () => {
    const timestamp = Math.floor(Date.now() / 1_000);
    const body = JSON.stringify({
      event: {
        app_user_id: "7b16dbdb-d7dd-4eec-9ddf-88dfec7407ea",
        environment: "PRODUCTION",
        event_timestamp_ms: Date.now(),
        id: "event-route-1",
        type: "TEST",
      },
    });

    const response = await request(createApp())
      .post("/api/supporter/revenuecat/webhook/production")
      .set("Authorization", AUTHORIZATION)
      .set("Content-Type", "application/json")
      .set("X-RevenueCat-Webhook-Signature", signBody(body, timestamp))
      .send(body)
      .expect(200);

    expect(response.body).toEqual({ duplicate: false, received: true });
    expect(supporter.ingestRevenueCatWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "production",
        eventId: "event-route-1",
      }),
      expect.stringMatching(/^[0-9a-f]{64}$/)
    );
  });
});
