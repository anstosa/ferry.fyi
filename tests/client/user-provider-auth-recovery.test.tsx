// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// create mutable auth state
const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(),
  isAuthenticated: true,
  isLoading: false,
  loginWithPopup: vi.fn(),
  loginWithRedirect: vi.fn(),
  user: { sub: "auth0|rider-0" },
}));
// create mutable api state
const api = vi.hoisted(() => ({
  get: vi.fn(),
}));
// create mutable device state
const device = vi.hoisted(() => ({
  current: null as null | { isNativeMobile: boolean; platform: string },
}));

// provide mutable auth state
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
// isolate native browser loading
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
// provide mutable device state
vi.mock("~/lib/device", () => ({ useDevice: () => device.current }));
// retain api error behavior
vi.mock("~/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/lib/api")>()),
  get: api.get,
}));

import { ApiError } from "../../client/lib/api";
import { useUser, UserProvider } from "../../client/lib/user";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let subjectSequence = 0;

// expose provider state
const UserProbe = (): ReactElement => {
  const [state] = useUser();
  return (
    <output data-error={state.userError?.message ?? ""}>
      {state.user?.user_id ?? (state.isUserLoading ? "loading" : "empty")}
    </output>
  );
};

// render one authenticated provider
const renderProvider = async (): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={["/account"]}>
        <UserProvider>
          <UserProbe />
        </UserProvider>
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

// reset provider fixtures
beforeEach(() => {
  subjectSequence += 1;
  auth.user = { sub: `auth0|rider-${subjectSequence}` };
  auth.getAccessTokenSilently.mockReset();
  auth.loginWithPopup.mockReset().mockResolvedValue(undefined);
  auth.loginWithRedirect.mockReset().mockResolvedValue(undefined);
  api.get.mockReset();
  device.current = null;
  vi.stubEnv("AUTH0_CLIENT_AUDIENCE", "https://ferry.fyi/api");
  vi.stubEnv("AUTH0_CLIENT_REDIRECT", "https://ferry.fyi/callback");
  vi.stubEnv("AUTH0_DOMAIN", "ferryfyi.us.auth0.com");
});

// remove provider fixtures
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("UserProvider auth recovery", () => {
  // refresh one rejected cached token
  it("retries an API 401 with a token fetched outside the Auth0 cache", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    auth.getAccessTokenSilently
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");
    api.get
      .mockRejectedValueOnce(new ApiError(401, { error: "Unauthorized" }))
      .mockResolvedValueOnce({ user_id: auth.user.sub });

    const container = await renderProvider();

    await vi.waitFor(() => expect(container.textContent).toBe(auth.user.sub));
    expect(auth.getAccessTokenSilently).toHaveBeenNthCalledWith(1, {
      authorizationParams: {
        audience: "https://ferry.fyi/api",
        scope: "openid profile email read:current_user offline_access",
      },
    });
    expect(auth.getAccessTokenSilently).toHaveBeenNthCalledWith(2, {
      authorizationParams: {
        audience: "https://ferry.fyi/api",
        scope: "openid profile email read:current_user offline_access",
      },
      cacheMode: "off",
    });
    expect(api.get).toHaveBeenNthCalledWith(1, "/user", "stale-token");
    expect(api.get).toHaveBeenNthCalledWith(2, "/user", "fresh-token");
    expect(auth.loginWithRedirect).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  // recover one rejected refreshed token
  it("starts interactive sign-in when a fresh token still receives 401", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    auth.getAccessTokenSilently
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("rejected-fresh-token");
    api.get.mockRejectedValue(
      new ApiError(401, { error: "Unauthorized" })
    );

    const container = await renderProvider();

    await vi.waitFor(() =>
      expect(auth.loginWithRedirect).toHaveBeenCalledOnce()
    );
    expect(auth.getAccessTokenSilently).toHaveBeenCalledTimes(2);
    expect(container.querySelector("output")?.dataset.error).toBe("");
    expect(container.textContent).toBe("loading");
  });

  // preserve the native callback during recovery
  it("opens Android reauthentication with the registered custom callback", async () => {
    device.current = { isNativeMobile: true, platform: "android" };
    auth.getAccessTokenSilently.mockRejectedValueOnce({
      error: "missing_refresh_token",
      error_description: "Missing Refresh Token",
    });

    await renderProvider();

    await vi.waitFor(() =>
      expect(auth.loginWithRedirect).toHaveBeenCalledOnce()
    );
    expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: { redirectPath: "/account" },
      authorizationParams: {
        audience: "https://ferry.fyi/api",
        prompt: "consent",
        redirect_uri:
          "fyi.ferry://ferryfyi.us.auth0.com/capacitor/fyi.ferry/callback",
        scope: "openid profile email read:current_user offline_access",
      },
      openUrl: expect.any(Function),
    });
  });
});
