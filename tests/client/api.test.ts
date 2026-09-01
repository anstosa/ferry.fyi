import { Capacitor } from "@capacitor/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  get,
  getApiBaseUrl,
  processResponse,
} from "../../client/lib/api";
import { installExceptionReporter } from "../../client/lib/errorReporting";

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
  it("keeps the public base path synchronous while native dispatch stays deferred", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    expect(getApiBaseUrl()).toBe("/api");
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

describe("API client authenticated request isolation", () => {
  // restore request adapters
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // never share one authenticated response across account tokens
  it("does not coalesce concurrent same-path reads across identities", async () => {
    const releases: Array<() => void> = [];
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    // capture each authenticated request independently
    const request = vi.fn(
      async (_url: string, input: RequestInit) =>
        await new Promise(
          // hold one response until both requests begin
          (resolve) => {
            const authorization = new Headers(input.headers).get(
              "Authorization"
            );
            releases.push(
              // release one identity-bound response
              () =>
                resolve(
                  new Response(JSON.stringify({ authorization }), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                  })
                )
            );
          }
        )
    );
    // install the browser capacitor http transport fixture
    vi.stubGlobal("fetch", request);

    const first = get<{ authorization: string }>("/features/me", "token-one");
    const second = get<{ authorization: string }>("/features/me", "token-two");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    // release both isolated responses
    releases.forEach(
      // release each isolated response
      (release) => release()
    );

    await expect(first).resolves.toEqual({ authorization: "Bearer token-one" });
    await expect(second).resolves.toEqual({
      authorization: "Bearer token-two",
    });
  });
});

describe("API client native failure reporting", () => {
  // restore native reporting fixtures
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ignore an expected schedule retry response
  it("does not report native schedule warming", async () => {
    const captureException = vi.fn();
    const removeReporter = installExceptionReporter(captureException);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: "warming" }), {
            headers: { "Content-Type": "application/json" },
            status: 503,
          })
        )
      )
    );

    await expect(get("/schedule/22/20/2026-09-01")).rejects.toMatchObject({
      status: 503,
    });

    expect(captureException).not.toHaveBeenCalled();
    removeReporter();
  });

  // retain an unexpected server failure
  it("reports an unrelated native server failure", async () => {
    const captureException = vi.fn();
    const removeReporter = installExceptionReporter(captureException);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "ticket_lookup_unavailable" }), {
            headers: { "Content-Type": "application/json" },
            status: 503,
          })
        )
      )
    );

    await expect(
      get("/tickets/private-ticket-id?token=private-token")
    ).rejects.toMatchObject({ status: 503 });

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0][0]).toMatchObject({
      message: "GET /tickets failed with status 503",
      method: "GET",
      name: "NativeApiServerError",
      operation: "/tickets",
      status: 503,
    });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain(
      "private-ticket-id"
    );
    expect(JSON.stringify(captureException.mock.calls)).not.toContain(
      "private-token"
    );
    removeReporter();
  });
});
