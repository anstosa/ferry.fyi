import { afterEach, describe, expect, it, vi } from "vitest";

// response fixture
const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });

// auth0 environment fixture
const configureAuth0 = (): void => {
  vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
  vi.stubEnv("AUTH0_SERVER_ID", "server-id");
  vi.stubEnv("AUTH0_SERVER_SECRET", "server-secret");
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Auth0 account linking", () => {
  it("preserves the Google primary while linking the database user id", async () => {
    configureAuth0();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "management-token", expires_in: 300 })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          email: "rider@example.com",
          email_verified: true,
          identities: [
            {
              connection: "google-oauth2",
              provider: "google-oauth2",
              user_id: "google-user",
            },
          ],
          user_id: "google-oauth2|google-user",
        })
      )
      .mockResolvedValueOnce(jsonResponse([], 201));
    vi.stubGlobal("fetch", fetch);
    const { linkAuth0UserIdentity } =
      await import("../../server/lib/auth0Admin");

    await expect(
      linkAuth0UserIdentity("google-oauth2|google-user", {
        connection: "Username-Password-Authentication",
        provider: "auth0",
        userId: "database-user",
      })
    ).resolves.toBe("linked");

    expect(fetch.mock.calls[2][0].toString()).toContain(
      "users/google-oauth2%7Cgoogle-user/identities"
    );
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      provider: "auth0",
      user_id: "database-user",
    });
  });

  it("does not link the same database identity twice", async () => {
    configureAuth0();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "management-token", expires_in: 300 })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          email: "rider@example.com",
          email_verified: true,
          identities: [
            {
              connection: "google-oauth2",
              provider: "google-oauth2",
              user_id: "google-user",
            },
            {
              connection: "Username-Password-Authentication",
              provider: "auth0",
              user_id: "database-user",
            },
          ],
          user_id: "google-oauth2|google-user",
        })
      );
    vi.stubGlobal("fetch", fetch);
    const { linkAuth0UserIdentity } =
      await import("../../server/lib/auth0Admin");

    await expect(
      linkAuth0UserIdentity("google-oauth2|google-user", {
        connection: "Username-Password-Authentication",
        provider: "auth0",
        userId: "database-user",
      })
    ).resolves.toBe("already-linked");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends verification only to the matching database identity", async () => {
    configureAuth0();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "management-token", expires_in: 300 })
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            email: "rider@example.com",
            email_verified: true,
            identities: [
              {
                connection: "google-oauth2",
                provider: "google-oauth2",
                user_id: "google-user",
              },
            ],
            user_id: "google-oauth2|google-user",
          },
          {
            email: "rider@example.com",
            email_verified: false,
            identities: [
              {
                connection: "Username-Password-Authentication",
                provider: "auth0",
                user_id: "database-user",
              },
            ],
            user_id: "auth0|database-user",
          },
        ])
      )
      .mockResolvedValueOnce(jsonResponse({ id: "job-id" }, 201));
    vi.stubGlobal("fetch", fetch);
    const { sendAuth0VerificationEmailForProvider } =
      await import("../../server/lib/auth0Admin");

    await expect(
      sendAuth0VerificationEmailForProvider({
        connection: "Username-Password-Authentication",
        email: "rider@example.com",
        provider: "auth0",
      })
    ).resolves.toBe("sent");

    expect(fetch.mock.calls[2][0].toString()).toContain(
      "jobs/verification-email"
    );
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      user_id: "auth0|database-user",
    });
  });
});
