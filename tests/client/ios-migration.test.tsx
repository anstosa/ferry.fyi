// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
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
vi.mock("~/components/Page", () => ({
  // page fixture
  Page: ({ children }: React.PropsWithChildren) => <>{children}</>,
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
    root?.render(<IosMigration />);
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
});
