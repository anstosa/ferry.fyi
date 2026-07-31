// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  navigate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ handleRedirectCallback: vi.fn() }),
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: mocks.addListener },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { close: vi.fn() },
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/", search: "" }),
  useNavigate: () => mocks.navigate,
  useRoutes: () => React.createElement("main"),
}));
vi.mock("~/components/AppLoadingState", () => ({
  AppLoadingState: () => null,
}));
vi.mock("~/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/components/InstallPromptToast", () => ({
  InstallPromptToast: () => null,
}));
vi.mock("~/components/LeaderboardForegroundCheckins", () => ({
  LeaderboardForegroundCheckins: () => null,
}));
vi.mock("~/components/NearbyTicketNotifications", () => ({
  NearbyTicketNotifications: () => null,
}));
vi.mock("~/components/Prompt", () => ({
  Prompt: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/lib/analytics", () => ({
  deferAnalytics: vi.fn(),
  useRecordPageViews: vi.fn(),
}));
vi.mock("~/lib/api", () => ({
  useOnline: () => true,
  useWSF: () => ({ offline: false }),
}));
vi.mock("~/lib/auth", () => ({
  isAuth0CallbackUrl: () => false,
}));
vi.mock("~/lib/device", () => ({
  useDevice: () => ({ isNativeMobile: false }),
}));
vi.mock("~/lib/ota", () => ({
  initializeOtaUpdater: () => Promise.resolve(),
}));
vi.mock("~/lib/push", () => ({
  usePush: () => vi.fn(),
}));
vi.mock("~/lib/terminals", () => ({
  slugs: [],
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [{ alertRules: [] }],
}));
vi.mock("~/routes", () => ({
  createAppRoutes: () => [],
}));
vi.mock("~/static/images/icons/solid/dumpster-fire.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/signal-alt-slash.svg", () => ({
  default: () => null,
}));

import { App } from "../../client/App";

let root: Root | undefined;

const renderApp = async (): Promise<void> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(React.createElement(App));
    await Promise.resolve();
  });
};

const backButtonCallback = (): ((event: { canGoBack: boolean }) => void) => {
  const call = mocks.addListener.mock.calls.find(
    ([eventName]) => eventName === "backButton"
  );
  if (!call) {
    throw new Error("Native back-button listener was not registered");
  }
  return call[1];
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.addListener.mockImplementation(() =>
    Promise.resolve({ remove: mocks.remove })
  );
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await Promise.resolve();
  });
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("App native back-button lifecycle", () => {
  it("registers exactly one back-button listener for a stable mount", async () => {
    await renderApp();

    await act(async () => {
      root?.render(React.createElement(App));
      await Promise.resolve();
    });

    expect(
      mocks.addListener.mock.calls.filter(
        ([eventName]) => eventName === "backButton"
      )
    ).toHaveLength(1);
  });

  it("navigates back when the native event can go back", async () => {
    await renderApp();

    act(() => backButtonCallback()({ canGoBack: true }));

    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });

  it("removes the registered listener when the app unmounts", async () => {
    await renderApp();

    await act(async () => {
      root?.unmount();
      root = undefined;
      await Promise.resolve();
    });

    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
