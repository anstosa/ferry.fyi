import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAuth0IssuerUrls,
  getAuth0ManagementAudience,
  getAuth0ManagementDomain,
  getAuth0UserInfoDomain,
} from "../../server/lib/auth0Config";

// jwt fixture
const makeToken = (issuer: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const payload = Buffer.from(JSON.stringify({ iss: issuer })).toString(
    "base64url"
  );
  return `${header}.${payload}.signature`;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Auth0 domain configuration", () => {
  it("keeps authentication branded while management uses the canonical tenant", () => {
    vi.stubEnv("AUTH0_DOMAIN", "auth.ferry.fyi");
    vi.stubEnv(
      "AUTH0_SERVER_AUDIENCE",
      "https://ferryfyi.us.auth0.com/api/v2/"
    );

    expect(getAuth0ManagementAudience()).toBe(
      "https://ferryfyi.us.auth0.com/api/v2/"
    );
    expect(getAuth0ManagementDomain()).toBe("ferryfyi.us.auth0.com");
    expect(getAuth0IssuerUrls()).toEqual([
      "https://auth.ferry.fyi/",
      "https://ferryfyi.us.auth0.com/",
    ]);
  });

  it("falls back to one domain when a separate management audience is absent", () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.test");
    vi.stubEnv("AUTH0_SERVER_AUDIENCE", undefined);

    expect(getAuth0ManagementAudience()).toBe(
      "https://tenant.example.test/api/v2/"
    );
    expect(getAuth0IssuerUrls()).toEqual(["https://tenant.example.test/"]);
  });

  it("routes user info to either trusted issuer during migration", () => {
    vi.stubEnv("AUTH0_DOMAIN", "auth.ferry.fyi");
    vi.stubEnv(
      "AUTH0_SERVER_AUDIENCE",
      "https://ferryfyi.us.auth0.com/api/v2/"
    );

    expect(
      getAuth0UserInfoDomain(makeToken("https://auth.ferry.fyi/"))
    ).toBe("auth.ferry.fyi");
    expect(
      getAuth0UserInfoDomain(makeToken("https://ferryfyi.us.auth0.com/"))
    ).toBe("ferryfyi.us.auth0.com");
    expect(getAuth0UserInfoDomain("opaque-token")).toBe("auth.ferry.fyi");
  });
});
