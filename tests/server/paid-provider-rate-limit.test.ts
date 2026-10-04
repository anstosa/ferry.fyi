import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiRateLimitMiddleware } from "../../server/lib/httpApiPolicy";

// restore quota configuration after each isolated middleware instance
afterEach(() => vi.unstubAllEnvs());

describe("paid provider quota response contracts", () => {
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
