// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("deferred browser phase", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    document.body.innerHTML = "";
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  // Both imports deliberately happen inside the test so its mocks own the
  // module graph. A cold Vite transform can exceed Vitest's 5s default when
  // this worker is contending with the broad suite.
  it("mounts real browser integrations only after the recovery shell commits", async () => {
    const authProvider = vi.fn(({ children }: React.PropsWithChildren) =>
      React.createElement(React.Fragment, undefined, children)
    );
    const initializeTheme = vi.fn(() => () => undefined);
    const initializeServiceWorker = vi.fn(() => () => undefined);
    const preloadBrowserRoute = vi.fn(() => Promise.resolve());

    vi.doMock("@auth0/auth0-react", () => ({
      Auth0Provider: authProvider,
      useAuth0: () => ({
        getAccessTokenSilently: vi.fn(),
        isAuthenticated: false,
        isLoading: false,
        loginWithRedirect: vi.fn(),
      }),
    }));
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { getPlatform: () => "web" },
    }));
    const app = vi.fn(() =>
      React.createElement("main", { "data-real-browser-app": "true" })
    );
    vi.doMock("~/App", () => ({ App: app }));
    vi.doMock("~/components/ErrorBoundary", () => ({
      ErrorBoundary: ({ children }: React.PropsWithChildren) => children,
    }));
    vi.doMock("~/lib/auth", () => ({
      getConfiguredAuth0RedirectUri: () => "https://ferry.fyi/callback",
    }));
    vi.doMock("~/lib/featureFlags", () => ({
      FeatureFlagProvider: ({ children }: React.PropsWithChildren) => children,
    }));
    vi.doMock("~/lib/renderContext", () => ({
      AppRenderProvider: ({ children }: React.PropsWithChildren) => children,
    }));
    vi.doMock("~/lib/theme", () => ({ initializeTheme }));
    vi.doMock("~/lib/user", () => ({
      UserProvider: ({ children }: React.PropsWithChildren) => children,
    }));
    vi.doMock("~/lib/worker", () => ({ initializeServiceWorker }));
    vi.doMock("~/routes", () => ({ preloadBrowserRoute }));

    vi.stubEnv("AUTH0_DOMAIN", "ferry.fyi.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "client-id");
    vi.stubEnv("AUTH0_CLIENT_AUDIENCE", "audience");
    vi.stubEnv("AUTH0_CLIENT_REDIRECT", "https://ferry.fyi/callback");

    const { InitialDocumentApp } = await import("../../client/entry-client");
    const browserModule = await import("../../client/browserApp");
    let resolveBrowserModule: (() => void) | undefined;
    const browserModuleReady = new Promise<void>((resolve) => {
      resolveBrowserModule = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        React.createElement(InitialDocumentApp, {
          documentMode: "failure",
          loadBrowserPhase: async () => {
            await browserModuleReady;
            return browserModule;
          },
          runtime: "browser",
        })
      );
    });
    expect(container.querySelector("main[aria-busy=true]")).not.toBeNull();
    expect(authProvider).not.toHaveBeenCalled();
    expect(initializeTheme).not.toHaveBeenCalled();
    expect(initializeServiceWorker).not.toHaveBeenCalled();

    await act(async () => {
      resolveBrowserModule!();
      await browserModuleReady;
    });
    expect(preloadBrowserRoute).toHaveBeenCalledWith("/", "ferry.fyi");
    expect(authProvider).toHaveBeenCalledOnce();
    expect(initializeTheme).toHaveBeenCalledOnce();
    expect(initializeServiceWorker).toHaveBeenCalledOnce();
    expect(app).toHaveBeenCalledWith(
      expect.objectContaining({ suspendInitialRoute: true }),
      undefined
    );
    expect(
      container.querySelector("[data-real-browser-app=true]")
    ).not.toBeNull();
  }, 30_000);
});
