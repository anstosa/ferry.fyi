import {
  type AddressSuggestion,
  type AddressSuggestionsResponse,
  isAddressSuggestion,
} from "shared/contracts/addressSuggestions";

import type { GoogleRoutesUsageRecorder } from "./googleRoutes";
import { googleRoutesUsageStore } from "./googleRoutesUsage";
import logger from "./logger";

export const GOOGLE_PLACES_ENDPOINT =
  "https://places.googleapis.com/v1/places:autocomplete";
export const GOOGLE_PLACES_TIMEOUT_MS = 2_500;
const FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");
const UNAVAILABLE: AddressSuggestionsResponse = {
  available: false,
  suggestions: [],
};

// reject malformed or expanded requests before any paid provider work
export const parseAddressSuggestionInput = (value: unknown): string | null => {
  // constrain the body to one ephemeral text field
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("input" in value) ||
    typeof value.input !== "string" ||
    value.input.trim().length < 3 ||
    value.input.length > 200 ||
    Array.from(value.input).some((character) => {
      // reject control bytes without inspecting or logging the origin
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  return value.input.trim();
};

// normalize just the prediction text and selected place identifiers
const normalizeSuggestions = (value: unknown): AddressSuggestionsResponse => {
  // treat an empty success response as no matches rather than a provider error
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return UNAVAILABLE;
  }
  const entries = (value as { suggestions?: unknown }).suggestions ?? [];
  // reject malformed or unbounded prediction collections
  if (!Array.isArray(entries) || entries.length > 5) {
    return UNAVAILABLE;
  }
  const suggestions: AddressSuggestion[] = [];
  // discard query predictions and retain only bounded place predictions
  for (const entry of entries) {
    const prediction = entry?.placePrediction;
    const suggestion = {
      address: prediction?.text?.text,
      placeId: prediction?.placeId,
      primaryText: prediction?.structuredFormat?.mainText?.text,
      secondaryText: prediction?.structuredFormat?.secondaryText?.text ?? "",
    };
    // prevent raw provider fields and duplicate options from reaching the browser
    if (
      isAddressSuggestion(suggestion) &&
      !suggestions.some((existing) => existing.placeId === suggestion.placeId)
    ) {
      suggestions.push(suggestion);
    }
  }
  return { available: true, suggestions };
};

// create one fixed-host, no-retry, privacy-bounded places adapter
export const createGooglePlacesAutocomplete = (
  dependencies: {
    apiKey?: () => string;
    enabled?: () => boolean;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    usage?: GoogleRoutesUsageRecorder;
  } = {}
): ((input: string) => Promise<AddressSuggestionsResponse>) => {
  const enabled =
    dependencies.enabled ??
    (() => process.env.GOOGLE_PLACES_ENABLED === "true");
  const apiKey =
    dependencies.apiKey ?? (() => process.env.GOOGLE_PLACES_API_KEY ?? "");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const usage = dependencies.usage ?? googleRoutesUsageStore;

  // account durably before sending any ephemeral query to google
  return async (input) => {
    const key = apiKey();
    // keep autocomplete closed without the explicit places gate and valid input
    if (!enabled() || !key || !parseAddressSuggestionInput({ input })) {
      return UNAVAILABLE;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let result = UNAVAILABLE;
    let stage = "accounting-open";
    try {
      const handle = await usage.open("autocomplete_requests", now());
      stage = "provider-request";
      timer = setTimeout(() => abort.abort(), GOOGLE_PLACES_TIMEOUT_MS);
      const response = await fetchImpl(GOOGLE_PLACES_ENDPOINT, {
        body: JSON.stringify({
          input,
          includeQueryPredictions: false,
          languageCode: "en-US",
          regionCode: "us",
          locationBias: {
            rectangle: {
              low: { latitude: 45, longitude: -125 },
              high: { latitude: 50, longitude: -119 },
            },
          },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        method: "POST",
        signal: abort.signal,
      });
      stage = "accounting-complete";
      await usage.complete(handle, response.ok ? "success" : "known-failure");
      stage = "provider-response";
      // never expose provider error bodies or retry a billable autocomplete call
      if (!response.ok) {
        return UNAVAILABLE;
      }
      result = normalizeSuggestions(await response.json());
      return result;
    } catch {
      return UNAVAILABLE;
    } finally {
      clearTimeout(timer);
      // record only fixed stages and aggregate timing not queries or exceptions
      try {
        logger.info("Google Places autocomplete result", {
          durationMs: Math.max(0, Date.now() - startedAt),
          result: result.available ? "available" : "unavailable",
          stage,
        });
      } catch {
        // keep diagnostic failures outside the normalized response boundary
      }
    }
  };
};
