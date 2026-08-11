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

  it("continues when Auth0 hides an existing user behind its generic response", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_CLIENT_ID", "web-client");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "invalid_signup",
            description: 'Invalid "sign up"',
            name: "BadRequestError",
            statusCode: 400,
          },
          { status: 400 }
        )
      )
    );

    await expect(
      createAuth0DatabaseAccount({
        email: "rider@example.com",
        password: "existing-password",
      })
    ).resolves.toBe("exists");
  });

  it("reports Auth0's failed password requirements", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_CLIENT_ID", "web-client");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "invalid_password",
            description: {
              rules: [
                {
                  format: [12],
                  message: "At least %d characters in length",
                  verified: false,
                },
                {
                  format: [3, 4],
                  items: [
                    {
                      message: "lower case letters (a-z)",
                      verified: true,
                    },
                    {
                      message: "upper case letters (A-Z)",
                      verified: false,
                    },
                    { message: "numbers (0-9)", verified: false },
                  ],
                  message:
                    "Contain at least %d of the following %d types of characters:",
                  verified: false,
                },
              ],
            },
            message: "Password is too weak",
          },
          { status: 400 }
        )
      )
    );

    await expect(
      createAuth0DatabaseAccount({
        email: "rider@example.com",
        password: "weak",
      })
    ).rejects.toThrow(
      "Password is too weak. At least 12 characters in length. Contain at least 3 of the following 4 types of characters: Missing: upper case letters (A-Z), numbers (0-9)"
    );
  });

  it("reports Auth0's direct signup error description", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_CLIENT_ID", "web-client");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "invalid_signup",
            description: "Username is required.",
          },
          { status: 400 }
        )
      )
    );

    await expect(
      createAuth0DatabaseAccount({
        email: "rider@example.com",
        password: "valid-password",
      })
    ).rejects.toThrow("Username is required.");
  });
});
