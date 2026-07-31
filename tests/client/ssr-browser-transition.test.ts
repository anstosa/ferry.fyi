// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PUBLIC_SSR_SNAPSHOT_VERSION } from "../../shared/contracts/ssr";
import {
  PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE,
  PUBLIC_SSR_SNAPSHOT_SCRIPT_ID,
} from "../../shared/contracts/ssrDocument";

const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/tickets",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/tickets",
    description: "Tickets",
    robots: "index,follow",
    title: "Tickets - Ferry FYI",
  },
  normalizedUrl: { path: "/tickets", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "tickets",
  routeParams: {},
  sources: {
    editorial: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: null,
      value: {
        contentRevision: "test",
        release: { publishedAt: null, version: "test" },
      },
    },
    ticketGuidance: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
      value: {
        capabilities: {
          barcodeScanner: "available",
          savedTickets: "after-hydration",
          ticketLookup: "after-hydration",
        },
        guidance: { body: "Seeded ticket guidance", title: "Tickets" },
      },
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as const;

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("server-to-browser app transition", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  // The imports and mocked lazy boundaries are intentionally exercised inside
  // the test; allow cold Vite transforms to finish under broad-suite load.
  it("preserves exact seeded markup and focus until the deferred browser phase is ready", async () => {
    let resolveBrowserApp:
      | ((module: {
          BrowserPhase: React.ComponentType<any>;
          preloadBrowserRoute: () => Promise<void>;
        }) => void)
      | undefined;
    let resolveBrowserRoute:
      | ((module: { default: React.ComponentType }) => void)
      | undefined;
    const browserApp = new Promise<{
      BrowserPhase: React.ComponentType<any>;
      preloadBrowserRoute: () => Promise<void>;
    }>((resolve) => {
      resolveBrowserApp = resolve;
    });
    const browserRoute = new Promise<{ default: React.ComponentType }>(
      (resolve) => {
        resolveBrowserRoute = resolve;
      }
    );
    const observedSnapshots: unknown[] = [];
    let browserModuleStartedAfterSeededCommit = false;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const AppFrame = ({
      children,
      snapshot: initialSnapshot,
    }: React.PropsWithChildren<{ snapshot?: typeof snapshot }>) => {
      observedSnapshots.push(initialSnapshot);
      return React.createElement(
        "div",
        { "data-app-transition-shell": "true" },
        React.createElement(
          "button",
          { id: "transition-sentinel", type: "button" },
          "Stable shell"
        ),
        children
      );
    };
    const UniversalRoutes = () => {
      return React.createElement(
        "main",
        { "data-phase": "seeded" },
        React.createElement(
          "p",
          { id: "seeded-guidance" },
          "Seeded ticket guidance"
        ),
        React.createElement("input", {
          defaultValue: "preserved focus",
          id: "seeded-focus",
        })
      );
    };
    const BrowserRoute = React.lazy(() => browserRoute);
    const BrowserDocument = ({
      suspendInitialRoute,
    }: {
      suspendInitialRoute: boolean;
    }) => {
      return suspendInitialRoute
        ? React.createElement(BrowserRoute)
        : React.createElement(
            React.Suspense,
            {
              fallback: React.createElement(
                "p",
                { id: "app-loading" },
                "AppLoading"
              ),
            },
            React.createElement(BrowserRoute)
          );
    };

    // These are deliberately the two phase boundaries, not application internals.
    // The deferred module lets the test hold the handoff between hydration commit
    // and browser-only initialization without mocking auth, native, or API code.
    vi.doMock("~/AppRoot", () => ({ AppFrame }));
    vi.doMock("~/routes", () => ({ UniversalRoutes }));
    vi.doMock("~/browserApp", () => {
      browserModuleStartedAfterSeededCommit = Boolean(
        document.querySelector("[data-phase=seeded]")
      );
      return browserApp;
    });

    document.body.innerHTML = [
      `<div id="root" ${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="snapshot"><div data-app-transition-shell="true"><button id="transition-sentinel" type="button">Stable shell</button><main data-phase="seeded"><p id="seeded-guidance">Seeded ticket guidance</p><input id="seeded-focus" value="preserved focus"></main></div></div>`,
      `<script id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}" type="application/json">${JSON.stringify(snapshot)}</script>`,
    ].join("");
    const sentinel = document.querySelector<HTMLButtonElement>(
      "#transition-sentinel"
    )!;
    sentinel.focus();

    const { startClientAppWhenReady } =
      await import("../../client/entry-client");
    startClientAppWhenReady();
    await act(async () => {
      document.dispatchEvent(new Event("DOMContentLoaded"));
    });
    await flush();

    expect(
      document.querySelector("[data-phase=seeded]")?.textContent
    ).toContain("Seeded ticket guidance");
    expect(document.activeElement).toBe(sentinel);
    expect(document.querySelector("[data-phase=browser]")).toBeNull();
    expect(observedSnapshots).toHaveLength(1);
    expect(browserModuleStartedAfterSeededCommit).toBe(true);

    await act(async () => {
      resolveBrowserApp!({
        BrowserPhase: BrowserDocument,
        preloadBrowserRoute: () => browserRoute.then(() => undefined),
      });
      await browserApp;
    });
    await flush();

    // Loading the browser shell alone cannot replace the committed document.
    // The selected route leaf has not resolved, so no browser providers or
    // loading fallback have rendered yet.
    expect(
      document.querySelector("[data-phase=seeded]")?.textContent
    ).toContain("Seeded ticket guidance");
    expect(document.querySelector("#app-loading")).toBeNull();
    expect(document.activeElement).toBe(sentinel);
    expect(observedSnapshots).toHaveLength(1);

    await act(async () => {
      resolveBrowserRoute!({
        default: () =>
          React.createElement(
            "main",
            { "data-phase": "browser" },
            React.createElement(
              "p",
              { id: "browser-guidance" },
              "Browser/live content"
            )
          ),
      });
      await browserRoute;
    });
    await flush();

    expect(
      document.querySelector("[data-phase=browser]")?.textContent
    ).toContain("Browser/live content");
    expect(observedSnapshots.length).toBeGreaterThan(1);
    expect(
      observedSnapshots.every((observed) => observed === observedSnapshots[0])
    ).toBe(true);
    expect(
      document.querySelector("[data-app-transition-shell=true]")
    ).not.toBeNull();
    expect(document.activeElement).toBe(sentinel);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringMatching(/another router|cannot render a <Router>/i)
    );
  }, 15_000);
});
