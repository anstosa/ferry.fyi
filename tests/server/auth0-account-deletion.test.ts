import { afterEach, describe, expect, it, vi } from "vitest";

// response fixture
const response = (status: number): Response => new Response(null, { status });

// auth0 environment fixture
const configureAuth0 = (): void => {
  vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
  vi.stubEnv(
    "AUTH0_SERVER_AUDIENCE",
    "https://tenant.example.test/api/v2/"
  );
  vi.stubEnv("AUTH0_SERVER_ID", "server-id");
  vi.stubEnv("AUTH0_SERVER_SECRET", "server-secret");
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Auth0 account deletion", () => {
  it("uses the canonical tenant for management with branded authentication", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "auth.ferry.fyi");
    vi.stubEnv(
      "AUTH0_SERVER_AUDIENCE",
      "https://ferryfyi.us.auth0.com/api/v2/"
    );
    vi.stubEnv("AUTH0_SERVER_ID", "server-id");
    vi.stubEnv("AUTH0_SERVER_SECRET", "server-secret");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "management-token",
            expires_in: 300,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      )
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetch);
    const { deleteAuth0User } = await import("../../server/lib/auth0Admin");

    await expect(deleteAuth0User("auth0|person")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe(
      "https://ferryfyi.us.auth0.com/oauth/token"
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      audience: "https://ferryfyi.us.auth0.com/api/v2/",
    });
    expect(fetch.mock.calls[1][0].toString()).toBe(
      "https://ferryfyi.us.auth0.com/api/v2/users/auth0%7Cperson"
    );
  });

  it("permanently deletes the encoded Auth0 subject", async () => {
    configureAuth0();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "management-token",
            expires_in: 300,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      )
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetch);
    const { deleteAuth0User } = await import("../../server/lib/auth0Admin");

    await expect(deleteAuth0User("auth0|person")).resolves.toBeUndefined();
    expect(fetch.mock.calls[1][0].toString()).toBe(
      "https://tenant.example.test/api/v2/users/auth0%7Cperson"
    );
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("fails closed when Auth0 rejects account deletion", async () => {
    configureAuth0();
    // token response fixture
    const tokenResponse = (accessToken: string): Response =>
      new Response(
        JSON.stringify({
          access_token: accessToken,
          expires_in: 300,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("old-management-token"))
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce(tokenResponse("new-management-token"))
      .mockResolvedValueOnce(response(403));
    vi.stubGlobal("fetch", fetch);
    const { deleteAuth0User } = await import("../../server/lib/auth0Admin");

    await expect(deleteAuth0User("auth0|person")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      (fetch.mock.calls[3][1]?.headers as Headers).get("Authorization")
    ).toBe("Bearer new-management-token");
  });

  it("refreshes a cached management token after permissions change", async () => {
    configureAuth0();
    // token response fixture
    const tokenResponse = (accessToken: string): Response =>
      new Response(
        JSON.stringify({
          access_token: accessToken,
          expires_in: 300,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("old-management-token"))
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce(tokenResponse("new-management-token"))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetch);
    const { deleteAuth0User } = await import("../../server/lib/auth0Admin");

    await expect(deleteAuth0User("auth0|person")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      (fetch.mock.calls[1][1]?.headers as Headers).get("Authorization")
    ).toBe("Bearer old-management-token");
    expect(
      (fetch.mock.calls[3][1]?.headers as Headers).get("Authorization")
    ).toBe("Bearer new-management-token");
  });
});
