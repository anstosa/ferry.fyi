import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuth0DatabaseAccount } from "../../client/lib/iosMigration";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("iOS migration Auth0 signup", () => {
  it("sends the new password directly to Auth0", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_CLIENT_ID", "web-client");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      createAuth0DatabaseAccount({
        email: "rider@example.com",
        password: "new-password",
      })
    ).resolves.toBe("created");

    expect(fetch).toHaveBeenCalledWith(
      "https://tenant.example.test/dbconnections/signup",
      expect.objectContaining({
        body: JSON.stringify({
          client_id: "web-client",
          connection: "Username-Password-Authentication",
          email: "rider@example.com",
          password: "new-password",
        }),
        method: "POST",
      })
    );
  });

  it("continues to identity verification when that database user exists", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_CLIENT_ID", "web-client");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 409 }))
    );

    await expect(
      createAuth0DatabaseAccount({
        email: "rider@example.com",
        password: "new-password",
      })
    ).resolves.toBe("exists");
  });
});
