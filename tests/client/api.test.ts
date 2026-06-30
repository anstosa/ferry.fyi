import { describe, expect, it } from "vitest";

import { ApiError, processResponse } from "../../client/lib/api";

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
});
