import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiRateLimitMiddleware,
  denyUntrustedPaidProviderOrigin,
} from "../../server/lib/httpApiPolicy";

// restore quota configuration after each isolated middleware instance
afterEach(() => vi.unstubAllEnvs());

describe("paid provider quota response contracts", () => {
  // enforce paid-provider controls on express-equivalent mixed-case paths
  it("guards and rate-limits the mixed-case full recommendation path", async () => {
    vi.stubEnv("API_PAID_PROVIDER_LIMIT", "1");
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    const invoked = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(denyUntrustedPaidProviderOrigin);
    app.use(createApiRateLimitMiddleware());
    app.post("/api/sailing-recommendations/v2", (_request, response) => {
      // record only requests admitted through both production policies
      invoked();
      response.send({ accepted: true });
    });
    const mixedCasePath = "/API/Sailing-Recommendations/V2";

    await request(app)
      .post(mixedCasePath)
      .set("Origin", "https://untrusted.invalid")
      .send({ mode: "walk" })
      .expect(403);
    await request(app).post(mixedCasePath).send({ mode: "walk" }).expect(200);
    const limited = await request(app)
      .post(mixedCasePath)
      .send({ mode: "walk" })
      .expect(429);

    expect(invoked).toHaveBeenCalledOnce();
    expect(limited.body.mode).toBe("walk");
    expect(limited.body.outcome.reason).toBe("provider-quota-unavailable");
  });

  // preserve the endpoint response shape at the outer abuse boundary
  it.each(["/address-suggestions", "/address-suggestions/", ""])(
    "normalizes quota exhaustion for sailing-recommendations%s",
    async (suffix) => {
      vi.stubEnv("API_PAID_PROVIDER_LIMIT", "1");
      const app = express();
      app.use(express.json());
      app.use("/api", createApiRateLimitMiddleware());
      app.post(
        `/api/sailing-recommendations${suffix}`,
        (_request, response) => {
          // avoid paid requests while exercising the full rate-limit boundary
          response.send({ accepted: true });
        }
      );
      const path = `/api/sailing-recommendations${suffix}`;
      expect(
        (await request(app).post(path).send({ mode: "walk" })).status
      ).toBe(200);
      const limited = await request(app).post(path).send({ mode: "walk" });
      expect(limited.status).toBe(429);
      expect(limited.headers["cache-control"]).toBe("no-store");
      // suggestions and route estimates have deliberately different contracts
      if (suffix) {
        expect(limited.body).toEqual({ available: false, suggestions: [] });
      } else {
        expect(limited.body.mode).toBe("walk");
        expect(limited.body.outcome.reason).toBe("provider-quota-unavailable");
      }
    }
  );
});
