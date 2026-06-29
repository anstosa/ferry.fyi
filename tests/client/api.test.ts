import { describe, expect, it } from "vitest";

import { processResponse } from "../../client/lib/api";

describe("API client response processing", () => {
  // json string envelope
  it("unwraps API envelopes returned as JSON strings", () => {
    const response = processResponse({
      data: JSON.stringify({
        body: { user_id: "auth0|123" },
        wsfStatus: { offline: false },
      }),
    } as Parameters<typeof processResponse>[0]);

    expect(response).toEqual({ user_id: "auth0|123" });
  });

  // invalid string guard
  it("leaves non-JSON string bodies unchanged", () => {
    const response = processResponse({
      data: "plain text",
    } as Parameters<typeof processResponse>[0]);

    expect(response).toBe("plain text");
  });
});
