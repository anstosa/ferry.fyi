// @vitest-environment jsdom

import React, { act, Suspense, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  location: vi.fn(() => ({ pathname: "/tickets", search: "" })),
  navigate: vi.fn(),
  routeElement: vi.fn<() => React.ReactElement>(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ handleRedirectCallback: vi.fn() }),
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: mocks.addListener },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { close: vi.fn(), open: vi.fn() },
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => mocks.location(),
  useNavigate: () => mocks.navigate,
  useRoutes: () => mocks.routeElement(),
}));
vi.mock("~/components/AppLoadingState", () => ({
  AppLoadingState: () => <p data-app-loading="true">App loading</p>,
}));
vi.mock("~/components/AutomaticCheckinsInstallBanner", () => ({
  AutomaticCheckinsInstallBanner: () => null,
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
vi.mock("~/components/NativeAppUpdatePrompt", () => ({
  NativeAppUpdatePrompt: () => null,
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
  getConfiguredAuth0RedirectUri: () => "https://ferry.fyi/callback",
  getIosAuthFailurePath: () => undefined,
  isAuth0CallbackUrl: () => false,
  isStaleAuth0CallbackError: () => false,
}));
vi.mock("~/lib/device", () => ({
  useDevice: () => ({ isNativeMobile: false, platform: "web" }),
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

// render the app under the retained document boundary
const renderApp = async (): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <Suspense fallback={<p data-retained-document="true">Retained</p>}>
        <App suspendInitialRoute />
      </Suspense>
    );
    await Promise.resolve();
  });
  return container;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.location.mockReturnValue({ pathname: "/tickets", search: "" });
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

describe("App route suspense lifecycle", () => {
  it("does not remount the committed route during a same-route rerender", async () => {
    let mountCount = 0;
    // count committed route mounts
    const RouteProbe = (): React.ReactElement => {
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <main data-route-probe="true">Tickets</main>;
    };
    mocks.routeElement.mockImplementation(() => <RouteProbe />);

    const container = await renderApp();
    expect(container.querySelector("[data-route-probe=true]")).not.toBeNull();
    expect(mountCount).toBe(1);

    await act(async () => {
      root?.render(
        <Suspense fallback={<p data-retained-document="true">Retained</p>}>
          <App suspendInitialRoute />
        </Suspense>
      );
      await Promise.resolve();
    });

    expect(mountCount).toBe(1);
  });

  it("bubbles initial suspension then owns later and returning-route loading", async () => {
    let pending: Promise<void> | undefined;
    let resolvePending: (() => void) | undefined;
    let ready = false;
    // expose route suspension
    const RouteProbe = (): React.ReactElement => {
      // suspend the selected route
      if (!ready) {
        throw pending;
      }
      return <main data-route-probe="true">Ready</main>;
    };
    // start a route suspension
    const suspendRoute = (): Promise<void> => {
      ready = false;
      pending = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });
      return pending;
    };
    // finish a route suspension
    const resolveRoute = async (): Promise<void> => {
      ready = true;
      resolvePending?.();
      await pending;
    };
    mocks.routeElement.mockImplementation(() => <RouteProbe />);

    const initialPending = suspendRoute();
    const container = await renderApp();

    expect(
      container.querySelector("[data-retained-document=true]")
    ).not.toBeNull();
    expect(container.querySelector("[data-app-loading=true]")).toBeNull();

    await act(async () => {
      await resolveRoute();
      await initialPending;
    });
    expect(container.querySelector("[data-route-probe=true]")).not.toBeNull();

    const nextPending = suspendRoute();
    mocks.location.mockReturnValue({ pathname: "/about", search: "" });
    await act(async () => {
      root?.render(
        <Suspense fallback={<p data-retained-document="true">Retained</p>}>
          <App suspendInitialRoute />
        </Suspense>
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-app-loading=true]")).not.toBeNull();
    expect(container.querySelector("[data-retained-document=true]")).toBeNull();

    await act(async () => {
      await resolveRoute();
      await nextPending;
    });

    const returnPending = suspendRoute();
    mocks.location.mockReturnValue({ pathname: "/tickets", search: "" });
    await act(async () => {
      root?.render(
        <Suspense fallback={<p data-retained-document="true">Retained</p>}>
          <App suspendInitialRoute />
        </Suspense>
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-app-loading=true]")).not.toBeNull();
    expect(container.querySelector("[data-retained-document=true]")).toBeNull();

    await act(async () => {
      await resolveRoute();
      await returnPending;
    });
  });
});
