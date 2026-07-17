import { describe, expect, it } from "vitest";

import { getAuth0RedirectUri } from "../../client/lib/auth";

describe("getAuth0RedirectUri", () => {
  it("uses Capacitor's Android callback URI on Android", () => {
    expect(
      getAuth0RedirectUri({
        domain: "ferryfyi.us.auth0.com",
        platform: "android",
        redirectUri: "fyi.ferry://callback",
      })
    ).toBe(
      "fyi.ferry://ferryfyi.us.auth0.com/capacitor/fyi.ferry/callback"
    );
  });

  it("keeps the configured callback URI on other platforms", () => {
    expect(
      getAuth0RedirectUri({
        domain: "ferryfyi.us.auth0.com",
        platform: "ios",
        redirectUri: "fyi.ferry://callback",
      })
    ).toBe("fyi.ferry://callback");
  });
});
