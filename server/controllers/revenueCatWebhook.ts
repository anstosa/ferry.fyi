import express, { Router } from "express";
import logger from "heroku-logger";
import type { SupporterEnvironment } from "shared/contracts/supporter";

import {
  hashRevenueCatWebhookBody,
  parseRevenueCatWebhook,
  verifyRevenueCatWebhook,
} from "~/lib/revenueCat";
import {
  ingestRevenueCatWebhook,
  processRevenueCatWebhookEvent,
} from "~/lib/supporter";

export const revenueCatWebhookRouter = Router();

// install exact-byte parsing before global json
revenueCatWebhookRouter.use(
  express.raw({ limit: "256kb", type: "application/json" })
);

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

revenueCatWebhookRouter.post("/production", handleWebhook("production"));
revenueCatWebhookRouter.post("/sandbox", handleWebhook("sandbox"));
