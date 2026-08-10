import { describe, expect, it, vi } from "vitest";

import {
  getAuth0RedirectUri,
  isAuth0CallbackUrl,
  isStaleAuth0CallbackError,
  loginWithAppFlow,
} from "../../client/lib/auth";

describe("getAuth0RedirectUri", () => {
  it("uses Capacitor's Android callback URI on Android", () => {
    expect(
      getAuth0RedirectUri({
        domain: "ferryfyi.us.auth0.com",
        platform: "android",
        redirectUri: "fyi.ferry://callback",
      })
    ).toBe("fyi.ferry://ferryfyi.us.auth0.com/capacitor/fyi.ferry/callback");
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

describe("isStaleAuth0CallbackError", () => {
  it("recognizes only Auth0's consumed-state replay error", () => {
    expect(isStaleAuth0CallbackError(new Error("Invalid state"))).toBe(true);
    expect(isStaleAuth0CallbackError(new Error("Login failed"))).toBe(false);
    expect(isStaleAuth0CallbackError("Invalid state")).toBe(false);
  });
});

describe("isAuth0CallbackUrl", () => {
  const nativeRedirectUri =
    "fyi.ferry://ferryfyi.us.auth0.com/capacitor/fyi.ferry/callback";

  it("recognizes the full Capacitor Android callback path", () => {
    expect(
      isAuth0CallbackUrl(
        `${nativeRedirectUri}?code=code&state=state`,
        nativeRedirectUri
      )
    ).toBe(true);
  });

  it("does not treat another app deep link as an Auth0 callback", () => {
    expect(
      isAuth0CallbackUrl(
        "fyi.ferry://ferryfyi.us.auth0.com/tickets?code=code&state=state",
        nativeRedirectUri
      )
    ).toBe(false);
  });

  it("recognizes the configured web callback", () => {
    expect(
      isAuth0CallbackUrl(
        "https://ferry.fyi/callback?code=code&state=state",
        "https://ferry.fyi/callback"
      )
    ).toBe(true);
  });

  it("recognizes the iOS callback whose callback name is the URL host", () => {
    expect(
      isAuth0CallbackUrl(
        "fyi.ferry://callback?code=code&state=state",
        "fyi.ferry://callback"
      )
    ).toBe(true);
  });

  it("recognizes an iOS callback normalized with a root path", () => {
    expect(
      isAuth0CallbackUrl(
        "fyi.ferry://callback/?code=code&state=state",
        "fyi.ferry://callback"
      )
    ).toBe(true);
  });
});

describe("loginWithAppFlow", () => {
  it("uses popup login only inside a development iframe", async () => {
    const loginWithPopup = vi.fn().mockResolvedValue(undefined);
    const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
    const authorizationParams = {
      audience: "https://api.ferry.fyi",
      redirect_uri: "http://localhost:4040/callback",
    };

    await loginWithAppFlow({
      environment: "development",
      framed: true,
      loginWithPopup,
      loginWithRedirect,
      options: {
        appState: { redirectPath: "/account" },
        authorizationParams,
      },
      popupRedirectUri: "https://dev.ferry.fyi/callback",
    });

    expect(loginWithPopup).toHaveBeenCalledWith({
      authorizationParams: {
        ...authorizationParams,
        redirect_uri: "https://dev.ferry.fyi/callback",
      },
    });
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });

  it.each([
    ["development", false],
    ["production", true],
    ["test", true],
  ])(
    "uses redirect login in %s when framed is %s",
    async (environment, framed) => {
      const loginWithPopup = vi.fn().mockResolvedValue(undefined);
      const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
      const options = { appState: { redirectPath: "/tickets" } };

      await loginWithAppFlow({
        environment,
        framed,
        loginWithPopup,
        loginWithRedirect,
        options,
      });

      expect(loginWithRedirect).toHaveBeenCalledWith(options);
      expect(loginWithPopup).not.toHaveBeenCalled();
    }
  );
});
