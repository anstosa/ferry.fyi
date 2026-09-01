import express, { Router } from "express";
import { MINUTE, rateLimit } from "express-rate-limit";
import type { SupporterEnvironment } from "shared/contracts/supporter";

import logger from "~/lib/logger";
import {
  hashRevenueCatWebhookBody,
  parseRevenueCatWebhook,
  verifyRevenueCatWebhook,
} from "~/lib/revenueCat";
import {
  ingestRevenueCatWebhook,
  processRevenueCatWebhookEvent,
} from "~/lib/supporter";

// handle one closure-bound provider environment
const handleWebhook =
  (environment: SupporterEnvironment) =>
  async (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction
  ): Promise<void> => {
    const { body } = request;
    // raw body guard
    if (!Buffer.isBuffer(body)) {
      response.status(400).send({ error: "invalid_body" });
      return;
    }
    let verified = false;
    // isolate missing configuration
    try {
      verified = verifyRevenueCatWebhook({
        authorization: request.get("authorization"),
        body,
        environment,
        signature: request.get("x-revenuecat-webhook-signature"),
      });
    } catch (error) {
      next(error);
      return;
    }
    // signature guard
    if (!verified) {
      response.status(401).send({ error: "invalid_webhook_signature" });
      return;
    }
    const envelope = parseRevenueCatWebhook(body, environment);
    // envelope guard
    if (!envelope) {
      response.status(400).send({ error: "invalid_webhook_event" });
      return;
    }
    try {
      const result = await ingestRevenueCatWebhook(
        envelope,
        hashRevenueCatWebhookBody(body)
      );
      response
        .status(200)
        .send({ duplicate: result.duplicate, received: true });
      // continue durable processing after acknowledgement
      setImmediate(() => {
        processRevenueCatWebhookEvent(result.eventId).catch(() => {
          logger.error("RevenueCat webhook reconciliation deferred", {
            environment,
          });
        });
      });
    } catch (error) {
      next(error);
    }
  };

// create one independently bounded webhook surface
export const createRevenueCatWebhookRouter = ({
  limit = 120,
  windowMs = MINUTE,
}: {
  limit?: number;
  windowMs?: number;
} = {}): Router => {
  const router = Router();
  const limiter = rateLimit({
    // keep limiter failures machine-readable
    handler: (_request, response) => {
      response.status(429).send({ error: "rate_limited" });
    },
    identifier: "revenuecat-webhook",
    legacyHeaders: false,
    limit,
    standardHeaders: "draft-8",
    windowMs,
  });
  const rawBody = express.raw({ limit: "256kb", type: "application/json" });
  router.post("/production", limiter, rawBody, handleWebhook("production"));
  router.post("/sandbox", limiter, rawBody, handleWebhook("sandbox"));
  return router;
};

export const revenueCatWebhookRouter = createRevenueCatWebhookRouter();
