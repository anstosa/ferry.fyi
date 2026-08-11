// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(),
  getAccessTokenWithPopup: vi.fn(),
  isAuthenticated: false,
  isLoading: false,
  loginWithRedirect: vi.fn(),
}));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const migration = vi.hoisted(() => ({
  createAuth0DatabaseAccount: vi.fn(),
  openWebIosMigration: vi.fn(),
}));
const renderContext = vi.hoisted(() => ({ platform: "web" }));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/api", () => api);
vi.mock("../../client/lib/iosMigration", () => migration);
vi.mock("~/lib/renderContext", () => ({
  useAppRenderContext: () => renderContext,
}));
vi.mock("~/components/SeoHelmet", () => ({
  // seo fixture
  SeoHelmet: () => null,
}));

import { IosMigration } from "../../client/views/IosMigration";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

// render fixture
const renderMigration = async (): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <IosMigration />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

// controlled input fixture
const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  renderContext.platform = "web";
});

describe("iOS account migration", () => {
  it("uses the full-screen Ferry FYI authentication shell", async () => {
    const container = await renderMigration();

    expect(container.querySelector("main")).not.toBeNull();
    expect(container.textContent).toContain("Ferry FYI");
    expect(container.textContent).toContain(
      "Make your Ferry FYI account iOS compatible"
    );
    expect(container.textContent).toContain(
      "Login with Google, add a username and password. Your saved routes, tickets, and alerts stay with you."
    );
    expect(
      container.querySelector('[aria-label="Migration steps"]')
    ).toBeNull();
  });

  it("starts with a fresh forced Google authentication without an email hint", async () => {
    const container = await renderMigration();

    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: { redirectPath: "/ios" },
      authorizationParams: {
        connection: "google-oauth2",
        max_age: 0,
        prompt: "login",
      },
    });
  });

  it("sends native iOS users to the web migration origin", async () => {
    renderContext.platform = "ios";
    const container = await renderMigration();
    expect(container.textContent).toContain("Open secure migration");
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Open secure migration"
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("could not open");
    expect(migration.openWebIosMigration).toHaveBeenCalledWith(
      "https://ferry.fyi/ios"
    );
    expect(auth.loginWithRedirect).not.toHaveBeenCalled();
  });

  it("requires password confirmation before creating the database identity", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "a-long-new-password");
      setInputValue(inputs[1], "different-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(migration.createAuth0DatabaseAccount).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Passwords do not match");
  });

  it("shows the exact Auth0 signup issue", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    migration.createAuth0DatabaseAccount.mockRejectedValueOnce(
      new Error("Username is required.")
    );
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "a-long-new-password");
      setInputValue(inputs[1], "a-long-new-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Username is required.");
    expect(container.textContent).not.toContain(
      "Use a stronger password and try again"
    );
  });

  it("sends the database identity verification email", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    migration.createAuth0DatabaseAccount.mockResolvedValue("created");
    api.post.mockResolvedValue({ status: "sent" });
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "a-long-new-password");
      setInputValue(inputs[1], "a-long-new-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith(
      "/ios-migration/verification-email",
      {},
      "primary-token"
    );
    expect(container.textContent).toContain(
      "We sent a verification email to rider@example.com"
    );
    expect(container.textContent).toContain("Resend verification email");
    expect(api.post).toHaveBeenCalledTimes(1);
    // finish action lookup
    const finish = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Authenticate with password and finish"
    );
    expect(finish?.disabled).toBe(false);
  });

  it("authenticates the new password identity before linking it", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    auth.getAccessTokenWithPopup.mockResolvedValue("secondary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    migration.createAuth0DatabaseAccount.mockResolvedValue("created");
    api.post
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValueOnce({ status: "linked" });
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "a-long-new-password");
      setInputValue(inputs[1], "a-long-new-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // finish action lookup
    const finish = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Authenticate with password and finish"
    );
    await act(async () => {
      finish?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(auth.getAccessTokenWithPopup).toHaveBeenCalledWith({
      authorizationParams: {
        audience: process.env.AUTH0_CLIENT_AUDIENCE,
        connection: "Username-Password-Authentication",
        login_hint: "rider@example.com",
        max_age: 0,
        prompt: "login",
        scope: "openid profile email read:current_user offline_access",
      },
    });
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/ios-migration/link",
      { secondaryAccessToken: "secondary-token" },
      "primary-token"
    );
    expect(container.textContent).toContain(
      "Your email and password login is connected"
    );
    expect(auth.loginWithRedirect).not.toHaveBeenCalled();
  });

  it("keeps finishing disabled until verification email delivery can retry", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    migration.createAuth0DatabaseAccount.mockResolvedValue("created");
    api.post
      .mockRejectedValueOnce(new Error("Auth0 unavailable"))
      .mockResolvedValueOnce({ status: "sent" });
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "a-long-new-password");
      setInputValue(inputs[1], "a-long-new-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    const finish = buttons.find(
      (button) => button.textContent === "Authenticate with password and finish"
    );
    const retry = buttons.find(
      (button) => button.textContent === "Resend verification email"
    );
    expect(finish?.disabled).toBe(true);
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finish?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("does not claim a new password was saved for an existing identity", async () => {
    auth.isAuthenticated = true;
    auth.getAccessTokenSilently.mockResolvedValue("primary-token");
    api.get.mockResolvedValue({
      email: "rider@example.com",
      state: "eligible",
    });
    migration.createAuth0DatabaseAccount.mockResolvedValue("exists");
    api.post.mockResolvedValue({ status: "already-verified" });
    const container = await renderMigration();
    const inputs = container.querySelectorAll("input");

    await act(async () => {
      setInputValue(inputs[0], "unused-new-password");
      setInputValue(inputs[1], "unused-new-password");
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "A password login already exists for rider@example.com"
    );
    expect(container.textContent).toContain("use Forgot password");
    expect(container.textContent).not.toContain("password you just created");
  });
});
