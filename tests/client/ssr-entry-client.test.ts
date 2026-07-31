// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeSentry } from "../../client/browserApp";
import {
  bootstrapClientApp,
  InitialDocumentApp,
  PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE,
} from "../../client/entry-client";
import { createServerApp } from "../../client/entry-server";
import { installClientRenderDiagnosticSink } from "../../client/lib/clientRenderTelemetry";
import { renderPublicSsrDocument } from "../../server/ssr/document";
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

const notFoundSnapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/404",
  hostProfile: "ferry.fyi",
  indexability: "noindex",
  metadata: {
    canonicalPath: "/404",
    description: "The requested Ferry FYI page could not be found.",
    robots: "noindex,follow",
    title: "Page Not Found - Ferry FYI",
  },
  normalizedUrl: { path: "/404", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "unknown-public-path",
  routeParams: {},
  sources: {},
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as const;

const script = (value: unknown = snapshot) =>
  `<script id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}" type="application/json">${JSON.stringify(value)}</script>`;

const prepare = (mode?: string, scripts = "", rootContent = "") => {
  document.body.innerHTML = `<div id="root"${mode ? ` ${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="${mode}"` : ""}>${rootContent}</div>${scripts}`;
  const rendered = vi.fn();
  const hydrated = vi.fn();
  const diagnostic = vi.fn();
  const app = vi.fn(() => React.createElement("main"));
  const result = bootstrapClientApp({
    createApp: app,
    createRootFactory: () => ({ render: rendered }) as unknown as Root,
    hydrateRootFactory: hydrated as never,
    reporter: diagnostic,
  });
  return { app, diagnostic, hydrated, rendered, result };
};

describe("client SSR document bootstrap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("hydrates only the explicit public snapshot mode with one compatible snapshot", () => {
    const { app, hydrated, rendered, result } = prepare(
      "snapshot",
      script(),
      "<main>Seeded document</main>"
    );

    expect(result).toBe("hydrate");
    expect(hydrated).toHaveBeenCalledTimes(1);
    expect(rendered).not.toHaveBeenCalled();
    expect(app.mock.calls[0][0]).toMatchObject({
      runtime: "hydrate",
      snapshot,
    });
  });

  it("hydrates the fixed request-neutral 404 snapshot without diagnostics", () => {
    const { app, diagnostic, hydrated, rendered, result } = prepare(
      "snapshot",
      script(notFoundSnapshot),
      "<main>Page not found</main>"
    );

    expect(result).toBe("hydrate");
    expect(hydrated).toHaveBeenCalledTimes(1);
    expect(rendered).not.toHaveBeenCalled();
    expect(diagnostic).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("canary");
    app.mock.calls[0][0].onCompatibleCommit?.();
    expect(
      document.querySelector(`#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`)
    ).toBeNull();
    expect(
      document
        .querySelector("#root")
        ?.getAttribute(PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE)
    ).toBe("true");
  });

  it("keeps server-rendered 404 markup on the universal tree after actual hydration", async () => {
    const server = await renderPublicSsrDocument({
      context: {
        clock: () => 1_753_704_000_000,
        platform: "web",
        requestUrl: "https://ferry.fyi/404",
        runtime: "server",
        seoBaseUrl: "https://ferry.fyi",
        seoHost: "ferry.fyi",
        seoPathname: "/404",
      },
      entry: { createServerApp },
      snapshot: notFoundSnapshot,
      template: '<html><head></head><body><div id="root"></div></body></html>',
    });
    const parsed = new DOMParser().parseFromString(server.html, "text/html");
    document.body.innerHTML = parsed.body.innerHTML;
    const root = document.querySelector("#root")!;
    const diagnostics = vi.fn();
    const loadBrowserPhase = vi.fn(() =>
      Promise.resolve({
        BrowserPhase: () => React.createElement("main", null, "Browser phase"),
        preloadBrowserRoute: () => Promise.resolve(),
      })
    );

    await act(async () => {
      hydrateRoot(
        root,
        React.createElement(InitialDocumentApp, {
          documentMode: "snapshot",
          loadBrowserPhase,
          runtime: "hydrate",
          snapshot: notFoundSnapshot,
        }),
        {
          onCaughtError: () => diagnostics("caught"),
          onRecoverableError: () => diagnostics("recoverable"),
          onUncaughtError: () => diagnostics("uncaught"),
        }
      );
      await Promise.resolve();
    });

    expect(root.textContent).toContain("Page not found");
    expect(root.textContent).not.toContain("Browser phase");
    expect(loadBrowserPhase).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it.each(["private", "callback", "disabled", "failure"])(
    "creates a CSR root for %s without parsing snapshot data",
    (mode) => {
      const { app, diagnostic, hydrated, rendered, result } = prepare(
        mode,
        script({ accessToken: "canary" })
      );

      expect(result).toBe("create");
      expect(hydrated).not.toHaveBeenCalled();
      expect(rendered).toHaveBeenCalledTimes(1);
      expect(app.mock.calls[0][0]).toEqual({
        documentMode: mode,
        onCompatibleCommit: undefined,
        runtime: "browser",
        snapshot: undefined,
      });
      expect(diagnostic).toHaveBeenCalledWith({
        category: "public-ssr-integrity-unexpected-snapshot",
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("canary");
      expect(
        document.querySelector(`#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`)
      ).toBeNull();
    }
  );

  it("reports a missing document mode and still creates a CSR root", () => {
    const { diagnostic, hydrated, result } = prepare();

    expect(result).toBe("create");
    expect(hydrated).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({
      category: "public-ssr-integrity-missing-mode",
    });
  });

  it.each([
    ["missing", "", "public-ssr-integrity-missing-snapshot"],
    [
      "invalid",
      script({ version: 0 }),
      "public-ssr-integrity-invalid-snapshot",
    ],
    [
      "duplicate",
      `${script()}${script()}`,
      "public-ssr-integrity-duplicate-snapshot",
    ],
  ])("safely recovers from a %s snapshot", (_name, scripts, category) => {
    const { app, diagnostic, hydrated, rendered, result } = prepare(
      "snapshot",
      scripts
    );

    expect(result).toBe("create");
    expect(hydrated).not.toHaveBeenCalled();
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(app.mock.calls[0][0].snapshot).toBeUndefined();
    expect(diagnostic).toHaveBeenCalledWith({ category });
  });

  it("reports an invalid explicit document mode without attempting hydration", () => {
    const { diagnostic, hydrated, result } = prepare("ssr-disabled");

    expect(result).toBe("create");
    expect(hydrated).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({
      category: "public-ssr-integrity-invalid-mode",
    });
  });

  it("does not hydrate an empty snapshot root even when its script is valid", () => {
    const { app, diagnostic, hydrated, rendered, result } = prepare(
      "snapshot",
      script()
    );

    expect(result).toBe("create");
    expect(hydrated).not.toHaveBeenCalled();
    expect(rendered).toHaveBeenCalledOnce();
    expect(app.mock.calls[0][0]).toMatchObject({
      runtime: "browser",
      snapshot,
    });
    expect(diagnostic).toHaveBeenCalledWith({
      category: "public-ssr-integrity-missing-rendered-root",
    });
    expect(
      document.querySelector(`#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`)
    ).toBeNull();
  });

  it("reports categorical hydration errors and retains a failed seed", () => {
    const { app, diagnostic, hydrated } = prepare(
      "snapshot",
      script(),
      "<main>Seeded document</main>"
    );
    const options = hydrated.mock.calls[0][2];

    options.onRecoverableError?.(new Error("state=private-canary"), {
      componentStack: "\n    at App",
    });
    expect(diagnostic).toHaveBeenCalledWith({
      category: "react-recoverable-error",
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      "private-canary"
    );

    app.mock.calls[0][0].onCompatibleCommit?.();
    expect(
      document
        .querySelector("#root")
        ?.getAttribute(PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE)
    ).toBeNull();
    expect(
      document.querySelector(`#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`)
    ).not.toBeNull();
  });

  it("buffers an initial hydration diagnostic until Sentry is ready", async () => {
    document.body.innerHTML = `<div id="root" ${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="snapshot"><main>Seeded document</main></div>${script()}`;
    const hydrated = vi.fn();
    bootstrapClientApp({
      createApp: () => React.createElement("main"),
      hydrateRootFactory: hydrated as never,
    });

    hydrated.mock.calls[0][2].onRecoverableError?.(
      new Error("private-canary"),
      { componentStack: "\n at App" }
    );
    const captureMessage = vi.fn();
    const cleanup = await initializeSentry({
      dsn: "https://public@example.invalid/1",
      load: () =>
        Promise.resolve({
          browserTracingIntegration: () => ({ name: "browser-tracing" }),
          captureMessage,
          init: vi.fn(),
        }),
    });

    expect(captureMessage).toHaveBeenCalledWith("Client render diagnostic", {
      level: "warning",
      tags: { category: "react-recoverable-error" },
    });
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(
      "private-canary"
    );
    cleanup();
  });

  it("consumes a compatible snapshot after a clean first commit", () => {
    const { app } = prepare(
      "snapshot",
      script(),
      "<main>Seeded document</main>"
    );

    app.mock.calls[0][0].onCompatibleCommit?.();
    expect(
      document
        .querySelector("#root")
        ?.getAttribute(PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE)
    ).toBe("true");
    expect(
      document.querySelector(`#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`)
    ).toBeNull();
  });

  it("defers private URL reads and router creation until the browser phase", async () => {
    let resolveBrowserPhase:
      | ((value: {
          BrowserPhase: React.ComponentType<{
            hostProfile: "ferry.fyi" | "howmanyboats.today";
            suspendInitialRoute: boolean;
          }>;
          preloadBrowserRoute: (
            pathname: string,
            hostProfile: "ferry.fyi" | "howmanyboats.today"
          ) => Promise<void>;
        }) => void)
      | undefined;
    const browserPhase = new Promise<{
      BrowserPhase: React.ComponentType<{
        hostProfile: "ferry.fyi" | "howmanyboats.today";
        suspendInitialRoute: boolean;
      }>;
      preloadBrowserRoute: (
        pathname: string,
        hostProfile: "ferry.fyi" | "howmanyboats.today"
      ) => Promise<void>;
    }>((resolve) => {
      resolveBrowserPhase = resolve;
    });
    let permitFullUrl = false;
    let fullUrlRead = false;
    const location = new Proxy(
      {
        host: "ferry.fyi:4177",
        origin: "https://ferry.fyi:4177",
        pathname: "/callback",
      },
      {
        get(target, property) {
          if (property === "href" || property === "search") {
            if (!permitFullUrl) {
              throw Error("private URL read before browser phase");
            }
            fullUrlRead = true;
            return "https://ferry.fyi/callback?code=canary";
          }
          return Reflect.get(target, property);
        },
      }
    ) as Pick<Location, "host" | "href" | "origin" | "pathname">;
    const base = document.createElement("base");
    base.href = "https://ferry.fyi/callback?code=base-canary&state=base-state";
    document.head.append(base);
    let baseUriReads = 0;
    Object.defineProperty(document, "baseURI", {
      configurable: true,
      get: () => {
        baseUriReads += 1;
        return base.href;
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(() => {
      root.render(
        React.createElement(InitialDocumentApp, {
          documentMode: "callback",
          loadBrowserPhase: () => browserPhase,
          location,
          runtime: "browser",
        })
      );
    });
    expect(container.querySelector("main[aria-busy=true]")).not.toBeNull();
    expect(fullUrlRead).toBe(false);
    expect(baseUriReads).toBe(0);
    expect(container.innerHTML).not.toContain("base-canary");
    expect(container.innerHTML).not.toContain("base-state");

    permitFullUrl = true;
    await act(async () => {
      resolveBrowserPhase!({
        BrowserPhase: ({ hostProfile }) => {
          const { href } = location;
          return React.createElement("main", {
            "data-browser-phase": href.includes("canary") ? "true" : "false",
            "data-host-profile": hostProfile,
          });
        },
        preloadBrowserRoute: (pathname, hostProfile) => {
          expect(pathname).toBe("/callback");
          expect(hostProfile).toBe("ferry.fyi");
          return Promise.resolve();
        },
      });
      await browserPhase;
    });
    expect(fullUrlRead).toBe(true);
    expect(container.querySelector("[data-browser-phase=true]")).not.toBeNull();
    expect(
      container.querySelector("[data-host-profile='ferry.fyi']")
    ).not.toBeNull();
    root.unmount();
    Reflect.deleteProperty(document, "baseURI");
    base.remove();
  });

  it.each([
    {
      failure: "loading the browser module",
      loadBrowserPhase: () =>
        Promise.reject(new Error("browser module unavailable")),
    },
    {
      failure: "preloading the browser route",
      loadBrowserPhase: () =>
        Promise.resolve({
          BrowserPhase: () => React.createElement("main"),
          preloadBrowserRoute: () =>
            Promise.reject(new Error("browser route unavailable")),
        }),
    },
  ])(
    "keeps the recovery shell and reports a diagnostic after $failure fails",
    async ({ loadBrowserPhase }) => {
      const diagnostic = vi.fn();
      const removeDiagnosticSink =
        installClientRenderDiagnosticSink(diagnostic);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(InitialDocumentApp, {
            documentMode: "failure",
            loadBrowserPhase,
            runtime: "browser",
          })
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(diagnostic).toHaveBeenCalledWith({
        category: "browser-phase-load-error",
      });
      expect(container.querySelector("main[aria-busy=true]")).not.toBeNull();

      removeDiagnosticSink();
      root.unmount();
    }
  );
});
