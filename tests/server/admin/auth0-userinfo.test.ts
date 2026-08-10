import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth0UserInfo } from "../../../server/lib/auth0Admin";

describe("Auth0 user info owner identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves the bounded profile for an existing validated access token", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "owner@example.test",
          email_verified: true,
          name: "Private profile value",
          sub: "auth0|owner",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetch);

    await expect(getAuth0UserInfo("validated-token")).resolves.toEqual({
      email: "owner@example.test",
      emailVerified: true,
      subject: "auth0|owner",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://tenant.example.test/userinfo",
      { headers: { Authorization: "Bearer validated-token" } }
    );
  });

  it("rejects a response without an Auth0 subject", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ email: "owner@example.test" }), {
          status: 200,
        })
      )
    );

    await expect(getAuth0UserInfo("validated-token")).rejects.toThrow(
      "subject was missing"
    );
  });
});
