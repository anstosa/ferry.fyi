// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const auth = vi.hoisted(() => ({
  logout: vi.fn(),
  user: undefined as Record<string, unknown> | undefined,
}));
const userState = vi.hoisted(() => ({
  alertRules: [],
  isUserLoading: false,
  tickets: [],
  user: null as Record<string, unknown> | null,
  userError: null as Error | null,
}));
const refreshUser = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const deleteAccount = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth,
  withAuthenticationRequired: (component: React.ComponentType) => component,
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [userState, { deleteAccount, refreshUser }],
}));
vi.mock("~/lib/device", () => ({ useDevice: () => null }));
vi.mock("~/lib/theme", () => ({
  useThemePreference: () => ["system", vi.fn()],
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ terminals: [] }),
}));
// page shell mock
vi.mock("~/components/Page", () => ({
  Page: ({
    children,
    headerAction,
  }: {
    children: React.ReactNode;
    headerAction?: React.ReactNode;
  }) =>
    React.createElement(
      React.Fragment,
      undefined,
      React.createElement(
        "header",
        { "data-testid": "page-header" },
        headerAction
      ),
      React.createElement("main", undefined, children)
    ),
}));
vi.mock("~/components/PageLoadError", () => ({
  PageLoadError: ({
    onReload,
    title,
  }: {
    onReload: () => void;
    title: string;
  }) =>
    React.createElement(
      "section",
      undefined,
      title,
      React.createElement("button", { onClick: onReload }, "Retry")
    ),
}));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/components/NotificationPermissionWarning", () => ({
  NotificationPermissionWarning: () => null,
}));
vi.mock("~/views/Tickets/storage", () => ({
  getReservationAccountCount: () => 0,
  ticketsAtom: {},
}));
vi.mock("jotai", () => ({ useAtomValue: () => [] }));

import { Account } from "../../client/views/Account";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  auth.user = undefined;
  userState.isUserLoading = false;
  userState.user = null;
  userState.userError = null;
  auth.logout.mockClear();
  deleteAccount.mockReset().mockResolvedValue(undefined);
  refreshUser.mockClear();
});

// controlled input fixture
const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

// route location fixture
const LocationProbe = (): React.ReactElement => {
  const location = useLocation();
  return React.createElement(
    "output",
    { "data-testid": "location" },
    location.pathname
  );
};

// account render fixture
const render = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/account"] },
        React.createElement(
          React.Fragment,
          undefined,
          React.createElement(Account),
          React.createElement(LocationProbe)
        )
      )
    )
  );
  return container;
};

describe("Account state predicates", () => {
  it("shows a retryable account error when initial metadata loading fails", () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.userError = new Error("offline");
    const container = render();
    expect(container.textContent).toContain("Account could not load");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")
        ?.click()
    );
    expect(refreshUser).toHaveBeenCalledOnce();
  });

  it("shows the account loading state while initial metadata is loading", () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.isUserLoading = true;
    const container = render();
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label")
    ).toBe("Loading account");
  });

  it("keeps account content while a metadata refresh fails", () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.isUserLoading = true;
    userState.user = {};
    userState.userError = new Error("offline");
    const container = render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Existing account details are still available"
    );
    expect(container.textContent).toContain("rider@example.com");
    expect(container.textContent).not.toContain("Account could not load");
  });

  it("renders profile details with an outline logout action in the top bar", () => {
    auth.user = {
      email: "rider@example.com",
      locale: "en-US",
      name: "Rider Example",
      nickname: "ferry-rider",
      sub: "google-oauth2|rider",
    };
    userState.user = {};
    const container = render();
    const profile = container.querySelector(
      'section[aria-labelledby="account-profile-name"]'
    );
    const avatar = profile?.querySelector('[aria-hidden="true"]');
    const logout = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Log Out"
    );

    expect(
      container
        .querySelector('[data-testid="page-header"]')
        ?.contains(logout ?? null)
    ).toBe(true);
    expect(profile?.contains(logout ?? null)).toBe(false);
    expect(avatar?.textContent).toBe("RE");
    expect(logout?.classList.contains("button-outline")).toBe(true);
    expect(profile?.textContent).toContain("Rider Example");
    expect(profile?.textContent).toContain("rider@example.com");
    expect(profile?.textContent).toContain("Google");
    expect(profile?.textContent).toContain("en-US");

    act(() => logout?.click());
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("requires typed confirmation and redirects home after deletion", async () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.user = {};
    const container = render();
    const deleteButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete account"
    );

    act(() => deleteButton?.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const confirmation = dialog?.querySelector<HTMLInputElement>("input");
    const permanentlyDelete = [
      ...(dialog?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent === "Permanently delete");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(permanentlyDelete?.disabled).toBe(true);

    await act(async () => {
      setInputValue(confirmation as HTMLInputElement, "DELETE");
      permanentlyDelete?.click();
      await Promise.resolve();
    });

    expect(deleteAccount).toHaveBeenCalledWith("DELETE");
    expect(auth.logout).toHaveBeenCalledWith({ openUrl: false });
    expect(
      container.querySelector('[data-testid="location"]')?.textContent
    ).toBe("/");
  });

  it("keeps the account active when permanent deletion fails", async () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.user = {};
    deleteAccount.mockRejectedValueOnce(new Error("Auth0 unavailable"));
    const container = render();

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Delete account")
        ?.click()
    );
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const confirmation = dialog?.querySelector<HTMLInputElement>("input");
    await act(async () => {
      setInputValue(confirmation as HTMLInputElement, "DELETE");
      [...(dialog?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Permanently delete")
        ?.click();
      await Promise.resolve();
    });

    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
      "could not confirm account deletion"
    );
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("continues completed deletion through the forced logout route", async () => {
    auth.user = {
      email: "rider@example.com",
      name: "Rider",
      sub: "auth0|rider",
    };
    userState.user = {};
    auth.logout.mockRejectedValueOnce(new Error("Local cache unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = render();

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Delete account")
        ?.click()
    );
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const confirmation = dialog?.querySelector<HTMLInputElement>("input");
    await act(async () => {
      setInputValue(confirmation as HTMLInputElement, "DELETE");
      [...(dialog?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Permanently delete")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-testid="location"]')?.textContent
    ).toBe("/logout");
    expect(container.textContent).not.toContain(
      "could not confirm account deletion"
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Local logout failed after account deletion",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
