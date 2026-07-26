import { afterEach, describe, expect, it, vi } from "vitest";

import { revokeAuth0UserCredentials } from "../../../server/lib/auth0Admin";

describe("Auth0 credential revocation capability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports partial when session revocation is unavailable instead of claiming SSO logout", async () => {
    process.env.AUTH0_DOMAIN = "tenant.example.test";
    process.env.AUTH0_SERVER_ID = "server-id";
    process.env.AUTH0_SERVER_SECRET = "server-secret";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            access_token: "management-token",
            expires_in: 300,
          }),
        ok: true,
      })
      .mockResolvedValueOnce({ json: () => Promise.resolve([]), ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetch);

    await expect(revokeAuth0UserCredentials("auth0|person")).resolves.toEqual({
      deviceCredentials: "complete",
      sessions: "unavailable",
      status: "partial",
    });
    expect(fetch.mock.calls[1][0].toString()).toContain(
      "device-credentials?user_id=auth0%7Cperson"
    );
    expect(fetch.mock.calls[2][0].toString()).toContain(
      "users/auth0%7Cperson/sessions"
    );
  });
});
