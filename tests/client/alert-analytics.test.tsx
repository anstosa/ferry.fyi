// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import {
  createFullDayAlertRule,
  getRouteSubscriptionKey,
} from "shared/lib/alertSubscriptions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertRules: [] as unknown[],
  permission: false,
  requestNotificationPermission: vi.fn(() => Promise.resolve(false)),
  requestPushInitialization: vi.fn(),
  trackUsefulEvent: vi.fn(),
  updateUser: vi.fn(() => Promise.resolve()),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
    loginWithPopup: vi.fn(),
    loginWithRedirect: vi.fn(),
  }),
}));
vi.mock("~/components/AppTeaser", () => ({ AppTeaser: () => null }));
vi.mock("~/components/HeaderDropdown", () => ({
  HeaderDropdown: () => null,
}));
vi.mock("~/components/NotificationPermissionWarning", () => ({
  NotificationPermissionWarning: () => null,
}));
vi.mock("~/components/Skeleton", () => ({
  Skeleton: () => null,
  SkeletonGroup: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/components/ToggleSwitch", () => ({ ToggleSwitch: () => null }));
vi.mock("~/lib/analytics", () => ({
  trackUsefulEvent: mocks.trackUsefulEvent,
}));
vi.mock("~/lib/auth", () => ({
  getConfiguredAuth0RedirectUri: () => "http://localhost/callback",
  loginWithAppFlow: vi.fn(),
}));
vi.mock("~/lib/device", () => ({ useDevice: () => null }));
vi.mock("~/lib/push", () => ({
  requestNotificationPermission: mocks.requestNotificationPermission,
  requestPushInitialization: mocks.requestPushInitialization,
}));
vi.mock("~/lib/schedule", () => ({ getSchedule: vi.fn() }));
vi.mock("~/lib/terminals", () => ({
  getSlug: (terminal: { name: string }) => terminal.name.toLowerCase(),
  useTerminals: () => ({ terminals: [] }),
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [
    {
      alertRules: mocks.alertRules,
      isUserLoading: false,
      user: { sub: "account-sentinel" },
      userError: null,
    },
    {
      refreshUser: vi.fn(),
      updateUser: mocks.updateUser,
    },
  ],
}));
vi.mock("../../client/views/Header", () => ({
  Header: ({ children }: React.PropsWithChildren) =>
    React.createElement("header", null, children),
}));

import { AlertSubscription } from "../../client/views/AlertSubscription";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const terminal = {
  abbreviation: "CLI",
  id: "5",
  name: "Clinton",
} as Terminal;
const mate = {
  abbreviation: "MUK",
  id: "14",
  name: "Mukilteo",
} as Terminal;

let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.alertRules = [];
  mocks.permission = false;
  mocks.requestNotificationPermission.mockImplementation(() =>
    Promise.resolve(mocks.permission)
  );
  mocks.updateUser.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// render one recurring-alert editor
const renderSubscription = (): HTMLDivElement => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter>
        <AlertSubscription mate={mate} setRoute={vi.fn()} terminal={terminal} />
      </MemoryRouter>
    );
  });
  return container;
};

// find a button by exact visible copy
const findButton = (
  container: HTMLElement,
  text: string
): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim().startsWith(text)
  );
  // required fixture button
  if (!button) {
    throw new Error(`Missing button ${text}`);
  }
  return button;
};

// select one channel and persist it
const saveDelayAlerts = async (container: HTMLElement): Promise<void> => {
  act(() => findButton(container, "Delays").click());
  await act(async () => {
    findButton(container, "Save alerts").click();
    await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
  });
};

describe("recurring alert analytics", () => {
  // denied permission still preserves the save
  it("qualifies a persisted alert even when permission is denied", async () => {
    const container = renderSubscription();

    await saveDelayAlerts(container);

    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("alert_saved", {
      kind: "recurring",
    });
    expect(mocks.requestPushInitialization).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.trackUsefulEvent.mock.calls)).not.toContain(
      "account-sentinel"
    );
  });

  // granted permission starts push separately
  it("initializes push separately after the same persisted milestone", async () => {
    mocks.permission = true;
    const container = renderSubscription();

    await saveDelayAlerts(container);

    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("alert_saved", {
      kind: "recurring",
    });
    expect(mocks.requestPushInitialization).toHaveBeenCalledOnce();
  });

  // unresolved persistence stays silent
  it("waits for persistence before qualifying the save", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.updateUser.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    const container = renderSubscription();

    act(() => findButton(container, "Delays").click());
    act(() => findButton(container, "Save alerts").click());
    await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();

    // settle the saved request
    await act(() => {
      resolveSave?.();
      return Promise.resolve();
    });
    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
  });

  // unsubscribe is not a saved-alert milestone
  it("does not qualify an unsubscribe persistence", async () => {
    mocks.alertRules = [
      createFullDayAlertRule({
        channels: ["delays"],
        id: "recurring-alert-sentinel",
        routeKey: getRouteSubscriptionKey([terminal.id, mate.id]),
        terminalIds: [terminal.id, mate.id],
      }),
    ];
    const container = renderSubscription();

    await act(async () => {
      findButton(container, "Turn off route alerts").click();
      await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
  });
});
