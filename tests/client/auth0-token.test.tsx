// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// isolate the SDK token source without replacing the guarded hook
const auth = vi.hoisted(() => ({ getAccessTokenSilently: vi.fn() }));
// expose the same SDK callback across renders
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));

import { useRequiredAuth0 } from "../../client/lib/auth0";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let getToken: ReturnType<typeof useRequiredAuth0>["getAccessTokenSilently"];

// capture the live token provider
const Probe = () => {
  getToken = useRequiredAuth0().getAccessTokenSilently;
  return null;
};

// mount an isolated hook fixture
beforeEach(() => {
  auth.getAccessTokenSilently.mockReset();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

// release the hook fixture
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// preserve required-token semantics across SDK upgrades
describe("required Auth0 access tokens", () => {
  // retain caller options and the token value
  it("forwards refresh options without changing the returned token", async () => {
    auth.getAccessTokenSilently.mockResolvedValueOnce("access-token");
    const options = { cacheMode: "off" as const };

    await expect(getToken(options)).resolves.toBe("access-token");
    expect(auth.getAccessTokenSilently).toHaveBeenCalledWith(options);
  });

  // stop missing credentials at the authentication boundary
  it.each([undefined, ""])("rejects an absent token %j", async (token) => {
    auth.getAccessTokenSilently.mockResolvedValueOnce(token);

    const request = getToken();
    await expect(request).rejects.toThrow("login_required");
    await expect(request).rejects.toMatchObject({ error: "login_required" });
  });

  // avoid retriggering effects that depend on the token provider
  it("keeps a stable provider while the SDK callback is unchanged", () => {
    const initialProvider = getToken;

    act(() => root?.render(<Probe />));

    expect(getToken).toBe(initialProvider);
  });
});
