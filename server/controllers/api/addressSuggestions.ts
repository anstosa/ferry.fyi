import { type RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AddressSuggestionsResponse } from "shared/contracts/addressSuggestions";

import {
  createGooglePlacesAutocomplete,
  parseAddressSuggestionInput,
} from "../../lib/googlePlaces";
import { createRecommendationCallLimiter } from "../../services/public/sailingRecommendations";

const defaultAdmitCall = createRecommendationCallLimiter();

// protect the paid suggestion endpoint independently of explicit route estimates
export const createAddressSuggestionRouter = (
  dependencies: {
    admitCall?: () => boolean;
    autocomplete?: (input: string) => Promise<AddressSuggestionsResponse>;
    rateLimiter?: RequestHandler;
  } = {}
): Router => {
  const router = Router();
  const autocomplete =
    dependencies.autocomplete ?? createGooglePlacesAutocomplete();
  const admitCall = dependencies.admitCall ?? defaultAdmitCall;
  // mark every response private before validation or rate limiting
  router.use((_request, response, next) => {
    response.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, noarchive",
    });
    next();
  });
  router.post(
    "/",
    dependencies.rateLimiter ??
      rateLimit({
        identifier: "address-suggestions-daily",
        legacyHeaders: false,
        limit: 200,
        standardHeaders: "draft-8",
        windowMs: 24 * 60 * 60 * 1000,
        // return only a neutral fallback on daily quota exhaustion
        handler: (_request, response) => {
          response.status(429).send({ available: false, suggestions: [] });
        },
      }),
    // forward only a validated input without logging origin text
    async (request, response) => {
      const input = parseAddressSuggestionInput(request.body);
      // reject malformed input before opening a billable attempt
      if (!input) {
        response.status(400).send({ error: "invalid_request" });
        return;
      }
      // bound provider traffic across this server process
      if (!admitCall()) {
        response.status(429).send({ available: false, suggestions: [] });
        return;
      }
      response.send(await autocomplete(input));
    }
  );
  return router;
};

export const addressSuggestionRouter = createAddressSuggestionRouter();
