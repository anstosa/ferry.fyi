import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAddressSuggestionRouter } from "../../server/controllers/api/addressSuggestions";
import {
  createGooglePlacesAutocomplete,
  GOOGLE_PLACES_ENDPOINT,
  parseAddressSuggestionInput,
} from "../../server/lib/googlePlaces";
import {
  classifyApiRequest,
  denyUntrustedPaidProviderOrigin,
} from "../../server/lib/httpApiPolicy";
import logger from "../../server/lib/logger";

const prediction = {
  placeId: "ChIJ_synthetic",
  text: { text: "Synthetic address, Seattle, WA" },
  structuredFormat: {
    mainText: { text: "Synthetic address" },
    secondaryText: { text: "Seattle, WA" },
  },
};
const result = {
  available: true,
  suggestions: [
    {
      address: prediction.text.text,
      placeId: prediction.placeId,
      primaryText: prediction.structuredFormat.mainText.text,
      secondaryText: prediction.structuredFormat.secondaryText.text,
    },
  ],
};

// construct provider doubles without connecting to google or the database
const adapter = (
  payload: unknown = { suggestions: [{ placePrediction: prediction }] },
  status = 200
) => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
  const usage = {
    open: vi
      .fn()
      .mockResolvedValue({ month: "2026-10", sku: "autocomplete_requests" }),
    complete: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies = {
    apiKey: () => "server-only-synthetic-key",
    enabled: () => true,
    fetchImpl,
    usage,
  };
  return {
    dependencies,
    fetchImpl,
    usage,
    autocomplete: createGooglePlacesAutocomplete(dependencies),
  };
};

// release synthetic flags and timers
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ephemeral google places autocomplete", () => {
  // keep diagnostics from replacing successful or unavailable suggestions
  it.each([200, 503])(
    "ignores a throwing log sink after HTTP %i",
    async (status) => {
      vi.spyOn(logger, "info").mockImplementation(() => {
        throw new Error("diagnostic sink unavailable");
      });
      const { autocomplete } = adapter(
        { suggestions: [{ placePrediction: prediction }] },
        status
      );
      expect(await autocomplete("Seattle")).toEqual(
        status === 200 ? result : { available: false, suggestions: [] }
      );
    }
  );

  // expose failed stages without disclosing the query or provider exception
  it.each([
    "accounting-open",
    "provider-request",
    "accounting-complete",
    "provider-response",
  ])("reports privacy-safe %s failures", async (stage) => {
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const { autocomplete, fetchImpl, usage } = adapter();
    const privateFailure = new Error("private-origin-and-key");
    // isolate each external failure boundary
    if (stage === "accounting-open") {
      usage.open.mockRejectedValue(privateFailure);
    }
    // isolate provider transport failures
    if (stage === "provider-request") {
      fetchImpl.mockRejectedValue(privateFailure);
    }
    // isolate counter completion failures
    if (stage === "accounting-complete") {
      usage.complete.mockRejectedValue(privateFailure);
    }
    // isolate malformed provider bodies
    if (stage === "provider-response") {
      fetchImpl.mockResolvedValue(new Response("private-provider-body"));
    }
    expect(await autocomplete("Sensitive starting address")).toEqual({
      available: false,
      suggestions: [],
    });
    const event = log.mock.calls[0]?.[1];
    expect(event).toEqual({
      durationMs: expect.any(Number),
      result: "unavailable",
      stage,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /Sensitive|private-origin|private-provider/
    );
  });

  // validate shape and input size before accounting or provider access
  it.each([
    null,
    [],
    {},
    { input: "ab" },
    { input: "a".repeat(201) },
    { input: "abc\n" },
    { input: "Seattle", origin: "private" },
  ])("rejects invalid input %j", (value) => {
    expect(parseAddressSuggestionInput(value)).toBeNull();
  });

  // normalize leading and trailing whitespace without retaining the body
  it("accepts a bounded input", () => {
    expect(parseAddressSuggestionInput({ input: " Seattle " })).toBe("Seattle");
  });

  // preserve the independent default-off places gate even if routes is enabled
  it("does no paid work when disabled or the separate key is absent", async () => {
    const { dependencies, fetchImpl, usage } = adapter();
    vi.stubEnv("GOOGLE_PLACES_ENABLED", "false");
    vi.stubEnv("GOOGLE_ROUTES_ENABLED", "true");
    expect(
      await createGooglePlacesAutocomplete({
        ...dependencies,
        enabled: undefined,
      })("Seattle")
    ).toEqual({ available: false, suggestions: [] });
    expect(
      await createGooglePlacesAutocomplete({
        ...dependencies,
        apiKey: () => "",
      })("Seattle")
    ).toEqual({ available: false, suggestions: [] });
    expect(await createGooglePlacesAutocomplete(dependencies)("ab")).toEqual({
      available: false,
      suggestions: [],
    });
    expect(usage.open).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // request only place predictions and keep the google key on the server
  it("uses a fixed host, narrow mask and existing usage accounting", async () => {
    const { autocomplete, fetchImpl, usage } = adapter();
    expect(await autocomplete("Seattle")).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_PLACES_ENDPOINT);
    expect(options?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "server-only-synthetic-key",
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      input: "Seattle",
      includeQueryPredictions: false,
      regionCode: "us",
      languageCode: "en-US",
    });
    expect(JSON.parse(String(options?.body))).not.toHaveProperty(
      "sessionToken"
    );
    expect(usage.open).toHaveBeenCalledWith(
      "autocomplete_requests",
      expect.any(Date)
    );
    expect(usage.open.mock.invocationCallOrder[0]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[0]
    );
    expect(usage.complete).toHaveBeenCalledWith(
      { month: "2026-10", sku: "autocomplete_requests" },
      "success"
    );
  });

  // prevent unmetered requests if the durable counter cannot open
  it("fails closed before network access when accounting is unavailable", async () => {
    const { autocomplete, fetchImpl, usage } = adapter();
    usage.open.mockRejectedValue(new Error("private database details"));
    expect(await autocomplete("Seattle")).toEqual({
      available: false,
      suggestions: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // keep known provider failures distinct from unresolved transport attempts
  it.each([403, 429, 503])(
    "sanitizes HTTP %i without retrying",
    async (status) => {
      const { autocomplete, fetchImpl, usage } = adapter(
        { private: "provider details" },
        status
      );
      expect(await autocomplete("Seattle")).toEqual({
        available: false,
        suggestions: [],
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(usage.complete).toHaveBeenCalledWith(
        expect.anything(),
        "known-failure"
      );
    }
  );

  // preserve successful request billing even when the response is malformed
  it("counts malformed success before discarding its body", async () => {
    const { autocomplete, fetchImpl, usage } = adapter();
    fetchImpl.mockResolvedValue(new Response("not-json", { status: 200 }));
    expect(await autocomplete("Seattle")).toEqual({
      available: false,
      suggestions: [],
    });
    expect(usage.complete).toHaveBeenCalledWith(expect.anything(), "success");
  });

  // leave interrupted attempts unresolved and prevent leaking exception details
  it("bounds a provider timeout without retrying", async () => {
    vi.useFakeTimers();
    const { autocomplete, fetchImpl, usage } = adapter();
    fetchImpl.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          // model fetch rejecting only when the adapter aborts
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("private timeout details"));
          });
        })
    );
    const pending = autocomplete("Seattle");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await pending).toEqual({ available: false, suggestions: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(usage.complete).not.toHaveBeenCalled();
  });

  // strip raw metadata, invalid place ids, duplicates and query predictions
  it("normalizes at most five bounded place options", async () => {
    const { autocomplete } = adapter({
      suggestions: [
        { placePrediction: { ...prediction, raw: "private" } },
        { placePrediction: prediction },
        { queryPrediction: { text: "not a place" } },
        { placePrediction: { ...prediction, placeId: "invalid\nidentifier" } },
      ],
    });
    expect(await autocomplete("Seattle")).toEqual(result);
    expect(await adapter({}).autocomplete("Seattle")).toEqual({
      available: true,
      suggestions: [],
    });
  });
});

describe("address suggestion api privacy boundary", () => {
  // mount the production origin policy around a synthetic provider
  const app = (admitCall = () => true) => {
    const autocomplete = vi.fn().mockResolvedValue(result);
    const server = express();
    server.use(express.json());
    server.use(denyUntrustedPaidProviderOrigin);
    server.use(
      "/api/sailing-recommendations/address-suggestions",
      createAddressSuggestionRouter({
        autocomplete,
        admitCall,
        rateLimiter: (_req, _res, next) => next(),
      })
    );
    return { server, autocomplete };
  };

  // preserve no-store and noindex headers without putting query text in a url
  it("accepts a body-only query with no cacheable origin data", async () => {
    const { server, autocomplete } = app();
    const response = await request(server)
      .post("/api/sailing-recommendations/address-suggestions")
      .send({ input: " Seattle " });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, noarchive");
    expect(response.body).toEqual(result);
    expect(autocomplete).toHaveBeenCalledExactlyOnceWith("Seattle");
    expect(
      classifyApiRequest({
        method: "POST",
        pathname: "/api/sailing-recommendations/address-suggestions",
      })
    ).toBe("paid-provider");
  });

  // reject malformed bodies, external origins and exhausted quotas before paid work
  it("keeps invalid, cross-site and limited requests off google", async () => {
    const { server, autocomplete } = app();
    expect(
      (
        await request(server)
          .post("/api/sailing-recommendations/address-suggestions")
          .send({ input: "Seattle", extra: "private" })
      ).status
    ).toBe(400);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    expect(
      (
        await request(server)
          .post("/api/sailing-recommendations/address-suggestions")
          .set("Origin", "https://untrusted.invalid")
          .send({ input: "Seattle" })
      ).status
    ).toBe(403);
    expect(autocomplete).not.toHaveBeenCalled();
    const limited = app(() => false);
    expect(
      (
        await request(limited.server)
          .post("/api/sailing-recommendations/address-suggestions")
          .send({ input: "Seattle" })
      ).status
    ).toBe(429);
    expect(limited.autocomplete).not.toHaveBeenCalled();
  });
});
