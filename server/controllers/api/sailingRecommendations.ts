import { type RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";

import {
  createSailingRecommendationService,
  parseSailingRecommendationRequest,
  type SailingRecommendationDependencies,
  unavailableRecommendation,
} from "../../services/public/sailingRecommendations";

// construct the daily paid-provider ip guard
export const createRecommendationDailyLimiter = (): RequestHandler =>
  rateLimit({
    identifier: "sailing-recommendations-daily",
    legacyHeaders: false,
    limit: 200,
    standardHeaders: "draft-8",
    windowMs: 24 * 60 * 60 * 1000,
    // preserve a sanitized quota reason on exhaustion
    handler: (request, response) => {
      const mode =
        parseSailingRecommendationRequest(request.body)?.mode ?? "drive";
      response.set({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, noarchive",
      });
      response
        .status(429)
        .send(
          unavailableRecommendation(
            mode,
            "provider-quota-unavailable",
            Date.now() / 1000
          )
        );
    },
  });

// mount one deliberately anonymous origin-sensitive post
export const createSailingRecommendationRouter = (
  dependencies: SailingRecommendationDependencies & {
    rateLimiter?: RequestHandler;
  } = {}
): Router => {
  const router = Router();
  const recommend = createSailingRecommendationService(dependencies);
  router.post(
    "/",
    dependencies.rateLimiter ?? createRecommendationDailyLimiter(),
    // return a bounded response without logging transient origins
    async (request, response) => {
      response.set({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, noarchive",
      });
      const input = parseSailingRecommendationRequest(request.body);
      // reject malformed origins without paid provider work
      if (!input) {
        response.status(400).send({ error: "invalid_request" });
        return;
      }
      response.send(await recommend(input));
    }
  );
  return router;
};

export const sailingRecommendationRouter = createSailingRecommendationRouter();
