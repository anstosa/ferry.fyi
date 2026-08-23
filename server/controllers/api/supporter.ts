import { Router } from "express";

import {
  createSupporterManagementLink,
  getSupporterStatus,
  reconcileSupporterSubject,
  SupporterAuthorizationError,
  SupporterRateLimitError,
} from "~/lib/supporter";

export const supporterRouter = Router();

supporterRouter.use((_request, response, next) => {
  response.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive, nofollow",
  });
  next();
});

// read one authenticated supporter account
supporterRouter.get("/", async (_request, response, next) => {
  // isolate supporter status failures
  try {
    response.send(
      await getSupporterStatus(
        response.locals.user.sub,
        response.locals.user.iat
      )
    );
  } catch (error) {
    // stale authentication guard
    if (error instanceof SupporterAuthorizationError) {
      response.status(401).send({ error: "unauthorized" });
      return;
    }
    next(error);
  }
});

// reconcile one authenticated supporter account
supporterRouter.post("/reconcile", async (_request, response) => {
  // isolate provider reconciliation failures
  try {
    const status = await reconcileSupporterSubject(
      response.locals.user.sub,
      response.locals.user.iat
    );
    response.send({ status, verification: "complete" });
  } catch (error) {
    // stale authentication guard
    if (error instanceof SupporterAuthorizationError) {
      response.status(401).send({ error: "unauthorized" });
      return;
    }
    // return the current fail-closed snapshot
    try {
      const status = await getSupporterStatus(
        response.locals.user.sub,
        response.locals.user.iat
      );
      response.status(202).send({ status, verification: "pending" });
    } catch {
      response.status(503).send({ error: "verification_unavailable" });
    }
  }
});

// create one source-authorized management destination
supporterRouter.post("/management", async (request, response, next) => {
  // isolate management provider failures
  try {
    const url = await createSupporterManagementLink(
      response.locals.user.sub,
      request.ip ?? "unknown"
    );
    response.send({ expiresAt: null, oneTime: true, url });
  } catch (error) {
    // durable rate limit guard
    if (error instanceof SupporterRateLimitError) {
      response.set("Retry-After", String(error.retryAfterSeconds));
      response.status(429).send({ error: "rate_limited" });
      return;
    }
    next(error);
  }
});
