// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  loginWithRedirect: vi.fn(),
}));
const browser = vi.hoisted(() => ({ open: vi.fn() }));
const renderContext = vi.hoisted(() => ({ platform: "ios" }));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("@capacitor/browser", () => ({ Browser: browser }));
vi.mock("~/components/SeoHelmet", () => ({
  // seo fixture
  SeoHelmet: () => null,
}));
vi.mock("~/lib/auth", () => ({
  getConfiguredAuth0RedirectUri: vi.fn(() => "fyi.ferry://callback"),
}));
vi.mock("~/lib/renderContext", () => ({
  useAppRenderContext: () => renderContext,
}));

import { Login } from "../../client/views/Login";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

// login page fixture
const renderLogin = async (): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

// cleanup fixture
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// reset fixture
beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  renderContext.platform = "ios";
});

describe("iOS login page", () => {
  // migration guidance contract
  it("explains password migration and links to the migration page", async () => {
    const container = await renderLogin();

    expect(container.querySelector("main")).not.toBeNull();
    expect(container.textContent).toContain("Ferry FYI");
    expect(container.textContent).toContain("Welcome back!");
    expect(container.textContent).not.toContain(
      "Apple doesn't allow social logins in this app"
    );
    expect(container.textContent).toContain(
      "If you previously signed in with Google"
    );
    expect(container.querySelector('a[href="/ios"]')?.textContent).toContain(
      "add a password"
    );
  });

  // password login contract
  it("opens Auth0 with the password database connection", async () => {
    const container = await renderLogin();
    const button = container.querySelector("button") as HTMLButtonElement;

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: { redirectPath: "/account" },
      authorizationParams: {
        connection: "Username-Password-Authentication",
        redirect_uri: "fyi.ferry://callback",
      },
      openUrl: expect.any(Function),
    });
    const [{ openUrl }] = auth.loginWithRedirect.mock.calls[0];
    await openUrl("https://tenant.example.test/authorize");
    expect(browser.open).toHaveBeenCalledWith({
      url: "https://tenant.example.test/authorize",
    });
  });
});
