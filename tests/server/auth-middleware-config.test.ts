import { afterEach, describe, expect, it, vi } from "vitest";

const auth0 = vi.hoisted(() => ({
  auth: vi.fn(() => vi.fn()),
}));

vi.mock("express-oauth2-jwt-bearer", () => auth0);
vi.mock("~/lib/admin/sessionRevocation", () => ({
  isApplicationTokenRevoked: vi.fn(),
}));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  auth0.auth.mockClear();
});

describe("Auth0 middleware configuration", () => {
  it("accepts branded and canonical issuers during the domain migration", async () => {
    vi.stubEnv("AUTH0_CLIENT_AUDIENCE", "https://ferry.fyi/api");
    vi.stubEnv("AUTH0_DOMAIN", "auth.ferry.fyi");
    vi.stubEnv(
      "AUTH0_SERVER_AUDIENCE",
      "https://ferryfyi.us.auth0.com/api/v2/"
    );

    await import("../../server/controllers/api/auth");

    expect(auth0.auth).toHaveBeenNthCalledWith(1, {
      audience: "https://ferry.fyi/api",
      mcd: {
        issuers: [
          "https://auth.ferry.fyi/",
          "https://ferryfyi.us.auth0.com/",
        ],
      },
    });
    expect(auth0.auth).toHaveBeenNthCalledWith(2, {
      audience: "https://ferry.fyi/api",
      authRequired: false,
      mcd: {
        issuers: [
          "https://auth.ferry.fyi/",
          "https://ferryfyi.us.auth0.com/",
        ],
      },
    });
  });
});
