import { Capacitor } from "@capacitor/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getApiBaseUrl, processResponse } from "../../client/lib/api";

describe("API client base URL", () => {
  // restore native mock
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // browser same-origin case
  it("uses same-origin API paths in browsers", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);

    expect(getApiBaseUrl()).toBe("/api");
  });

  // native absolute-origin case
  it("preserves absolute API paths for native shells", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");

    expect(getApiBaseUrl()).toBe("https://ferry.fyi/api");
  });
});

describe("API client response processing", () => {
  // json string envelope
  it("unwraps API envelopes returned as JSON strings", () => {
    const response = processResponse({
      data: JSON.stringify({
        body: { user_id: "auth0|123" },
        wsfStatus: { offline: false },
      }),
      headers: {},
      status: 200,
      url: "http://localhost/api/user",
    } as Parameters<typeof processResponse>[0]);

    expect(response).toEqual({ user_id: "auth0|123" });
  });

  // invalid string guard
  it("leaves non-JSON string bodies unchanged", () => {
    const response = processResponse({
      data: "plain text",
      headers: {},
      status: 200,
      url: "http://localhost/api/plain",
    } as Parameters<typeof processResponse>[0]);

    expect(response).toBe("plain text");
  });

  // http error behavior
  it("throws API errors for non-success statuses", () => {
    expect(() =>
      processResponse({
        data: JSON.stringify({ error: "ticket_lookup_unavailable" }),
        headers: {},
        status: 503,
        url: "http://localhost/api/tickets/123",
      } as Parameters<typeof processResponse>[0])
    ).toThrow(ApiError);
  });

  // malformed status envelope
  it("ignores API envelopes with invalid WSF status", () => {
    const response = processResponse({
      data: JSON.stringify({
        body: { route: "edmonds-kingston" },
        wsfStatus: undefined,
      }),
      headers: {},
      status: 200,
      url: "http://localhost/api/schedule/1/2",
    } as Parameters<typeof processResponse>[0]);

    expect(response).toEqual({ route: "edmonds-kingston" });
  });
});
