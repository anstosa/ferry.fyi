import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppRenderContextValue } from "../../client/lib/renderContext";
import { PUBLIC_SSR_SNAPSHOT_VERSION } from "../../shared/contracts/ssr";
import {
  createStaticPublicSsrTerminalResolver,
  matchPublicSsrRoute,
} from "../../shared/lib/ssrRouteMatch";
import { PUBLIC_SSR_ROUTE_MANIFEST } from "../../shared/lib/ssrRoutes";

type HelmetContext = Record<string, unknown> & {
  helmet?: { meta: { toString(): string } };
};

const render = async (
  requestUrl: string,
  snapshot?: import("../../shared/contracts/ssr").PublicSsrSnapshot
): Promise<{ helmet: string; markup: string }> => {
  const { AppRoot } = await import("../../client/AppRoot");
  const context: AppRenderContextValue = {
    clock: () => 1_700_000_000_000,
    hasInjectedRequest: false,
    platform: "web",
    requestUrl,
    runtime: "server",
    seoBaseUrl: "https://ferry.fyi",
    seoHost: "ferry.fyi",
    seoPathname: new URL(requestUrl).pathname,
  };
  const helmetContext: HelmetContext = {};
  const markup = renderToStaticMarkup(
    React.createElement(AppRoot, { context, helmetContext, snapshot })
  );
  return {
    helmet: helmetContext.helmet?.meta.toString() ?? "",
    markup,
  };
};

const createPublicSsrFixtures = () => {
  const terminal = {
    abbreviation: "CLI",
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: true,
    hasWaitingRoom: true,
    id: "5",
    info: {},
    location: {
      address: null,
      latitude: 47.9,
      link: null,
      longitude: -122.3,
    },
    mates: [{ abbreviation: "MUK", id: "14", name: "Mukilteo" }],
    name: "Clinton",
    popularity: 1,
    routes: {
      route: {
        abbreviation: "CLI-MUK",
        crossingTime: 20,
        date: "2026-07-28",
        description: "Clinton to Mukilteo",
        id: "route",
        terminalIds: ["5", "14"],
      },
    },
    terminalUrl: null,
    vesselWatchUrl: null,
    waitTimes: [],
  };
  const mate = {
    ...terminal,
    abbreviation: "MUK",
    id: "14",
    mates: [{ abbreviation: "CLI", id: "5", name: "Clinton" }],
    name: "Mukilteo",
  };
  const source = (value: unknown) => ({
    observedAt: "2026-07-28T12:00:00.000Z",
    outcome: "value",
    sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
    value,
  });
  const snapshot = {
    canonicalHost: "ferry.fyi",
    canonicalPath: "/clinton",
    hostProfile: "ferry.fyi",
    indexability: "indexable",
    metadata: {
      canonicalPath: "/clinton",
      description: "Clinton",
      robots: "index,follow",
      title: "Clinton - Ferry FYI",
    },
    normalizedUrl: { path: "/clinton", query: {} },
    renderedAt: "2026-07-28T12:00:00.000Z",
    routeId: "terminal-schedule",
    routeParams: { terminalSlug: "clinton" },
    sources: {
      alertGuidance: source({
        body: "Choose alerts after sign-in.",
        title: "Ferry alerts",
      }),
      bulletins: source([]),
      cameraFrames: source({ frames: {}, sourceUpdatedAt: null }),
      fares: source({
        catalog: { fares: [] },
        state: "current",
      }),
      nextSchedule: source({
        schedule: {
          date: "2026-07-29",
          mateId: "14",
          slots: [],
          terminalId: "5",
          validRange: null,
        },
      }),
      notices: source({
        announcements: [
          {
            body: "Use the alternate dock this afternoon.",
            id: "dock-change",
            title: "Dock change",
          },
        ],
        maintenance: { enabled: false, message: "" },
      }),
      route: source({ mate, terminal }),
      schedule: source({
        schedule: {
          date: "2026-07-28",
          mateId: "14",
          slots: [
            {
              allowsPassengers: true,
              allowsVehicles: true,
              crossing: {
                arrivalId: "14",
                departureDelta: null,
                departureId: "5",
                departureTime: 1_753_704_000,
                driveUpCapacity: 18,
                hasDriveUp: true,
                hasReservations: false,
                isCancelled: false,
                reservableCapacity: 0,
                totalCapacity: 144,
                vesselName: "Tokitae",
              },
              estimate: {
                driveUpCapacity: 12,
                fullRisk: "unlikely",
                reservableCapacity: 0,
              },
              hasPassed: false,
              mateId: "14",
              time: 1_753_704_000,
              vessel: { id: "1", name: "Tokitae" },
              wuid: "seeded-sailing",
            },
          ],
          terminalId: "5",
          validRange: null,
        },
      }),
      vessels: source([]),
      wsf: source({ offline: false }),
    },
    version: PUBLIC_SSR_SNAPSHOT_VERSION,
  } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
  return { mate, snapshot, source, terminal };
};

const createTodaySnapshot = (
  snapshot: import("../../shared/contracts/ssr").PublicSsrSnapshot
): import("../../shared/contracts/ssr").PublicSsrSnapshot => ({
  ...snapshot,
  canonicalPath: "/today",
  metadata: { ...snapshot.metadata, canonicalPath: "/today" },
  normalizedUrl: { path: "/today", query: {} },
  routeId: "today",
  sources: {
    nextSchedule: snapshot.sources.nextSchedule,
    notices: snapshot.sources.notices,
    route: snapshot.sources.route,
    schedule: snapshot.sources.schedule,
    wsf: snapshot.sources.wsf,
  },
});

describe("AppRoot server rendering", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The cold Vite module graph import runs under browser-global canaries.
  it("imports and renders the real public About view without browser globals", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal(
      "location",
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("SEO read global location");
          },
        }
      )
    );
    const { markup } = await render("https://ferry.fyi/about");

    expect(markup).toContain("A ferry schedule and tracker");
    expect(markup).toContain("Made with love by");
    expect(markup).toContain("Weather data and forecasts");
  }, 30_000);

  it("does not import native SDKs for the universal About tree", async () => {
    vi.resetModules();
    vi.doMock("@capacitor/app", () => {
      throw new Error("AppRoot imported @capacitor/app");
    });
    vi.doMock("@capacitor/core", () => {
      throw new Error("AppRoot imported @capacitor/core");
    });
    vi.doMock("@capgo/capacitor-updater", () => {
      throw new Error("AppRoot imported @capgo/capacitor-updater");
    });

    const { markup } = await render("https://ferry.fyi/about");

    expect(markup).toContain("A ferry schedule and tracker");
  });

  it("is stable for fixed request and runtime inputs", async () => {
    expect(await render("https://ferry.fyi/about")).toEqual(
      await render("https://ferry.fyi/about")
    );
  });

  it("uses injected SEO rather than global location", async () => {
    const rendered = await render("https://ferry.fyi/about");

    // The SEO component can derive the canonical URL from context even when
    // this node-only renderer has no global location object.
    expect(rendered.helmet || rendered.markup).toContain("ferry.fyi");
  });

  it("does not expose callback query values in client-only markup", async () => {
    const { markup, helmet } = await render(
      "https://ferry.fyi/callback?code=secret-code&state=secret-state"
    );

    expect(helmet || markup).toContain("noindex,follow");
    expect(markup).not.toContain("secret-code");
    expect(markup).not.toContain("secret-state");
  });

  it("renders private paths as deterministic noindex placeholders", async () => {
    const { markup, helmet } = await render(
      "https://ferry.fyi/account?token=private-value"
    );

    expect(helmet || markup).toContain("noindex,follow");
    expect(markup).not.toContain("private-value");
  });

  it("derives both route modes from the shared route manifest", async () => {
    const { createAppRoutes } = await import("../../client/routes");
    const noBoundary = (_label: string, element: React.ReactElement) => element;
    const universalPaths = createAppRoutes(noBoundary, "universal").map(
      (route) => route.path
    );
    const browserPaths = createAppRoutes(noBoundary, "browser").map(
      (route) => route.path
    );

    expect(universalPaths).toEqual(
      PUBLIC_SSR_ROUTE_MANIFEST.map((route) => route.path)
    );
    expect(browserPaths).toContain("/about");
    expect(browserPaths.every((path) => universalPaths.includes(path))).toBe(
      true
    );
  });

  it("renders each terminal route tab from its anonymous seed", async () => {
    const { snapshot } = createPublicSsrFixtures();
    const expected = new Map<string, { sources: string[]; text: string }>([
      [
        "/clinton",
        {
          sources: [
            "route",
            "schedule",
            "nextSchedule",
            "wsf",
            "bulletins",
            "notices",
          ],
          text: "Clinton",
        },
      ],
      [
        "/clinton/mukilteo/cameras",
        {
          sources: ["route", "cameraFrames", "notices"],
          text: "This terminal does not have cameras",
        },
      ],
      [
        "/clinton/mukilteo/terminal",
        { sources: ["route", "notices"], text: "Clinton" },
      ],
      [
        "/clinton/mukilteo/fare",
        {
          sources: ["route", "fares", "notices"],
          text: "Fare estimator",
        },
      ],
      [
        "/clinton/mukilteo/map",
        {
          sources: ["route", "vessels", "notices"],
          text: "Live vessel positions",
        },
      ],
      [
        "/clinton/mukilteo/alerts",
        {
          sources: ["route", "bulletins", "notices"],
          text: "No active alerts",
        },
      ],
      [
        "/clinton/mukilteo/subscribe",
        {
          sources: ["route", "alertGuidance", "notices"],
          text: "Choose alerts after sign-in.",
        },
      ],
    ]);

    for (const [path, expectation] of expected) {
      try {
        const description = `Metadata for ${path}`;
        const routeSnapshot = {
          ...snapshot,
          canonicalPath: path,
          metadata: {
            ...snapshot.metadata,
            canonicalPath: path,
            description,
          },
          normalizedUrl: { path, query: {} },
        };
        const { resolveSnapshotSeo } =
          await import("../../client/views/PublicSsrPages");
        expect(
          resolveSnapshotSeo(
            routeSnapshot.metadata,
            routeSnapshot.metadata as never
          ).description
        ).toBe(description);
        const { markup } = await render(
          `https://ferry.fyi${path}`,
          routeSnapshot
        );
        expect(markup).toContain(expectation.text);
        expectation.sources.forEach((sourceKey) =>
          expect(markup).toContain(`data-public-ssr-source="${sourceKey}"`)
        );
        if (path === "/clinton") {
          expect(markup).toContain('data-public-ssr-freshness="schedule"');
          expect(markup).toContain("<time");
          expect(markup).toContain("18 vehicle spaces reported");
          expect(markup).toContain("forecast 12 vehicle spaces");
          expect(markup).toContain("Dock change");
        }
        if (path.endsWith("/cameras")) {
          expect(markup).toContain('data-public-ssr-freshness="cameraFrames"');
        }
      } catch (error) {
        throw new Error(`${path}: ${String(error)}`);
      }
    }
  }, 15_000);

  it("renders the public home route from its anonymous seed", async () => {
    const { mate, snapshot, source, terminal } = createPublicSsrFixtures();
    const homeSnapshot = {
      ...snapshot,
      canonicalPath: "/",
      metadata: { ...snapshot.metadata, canonicalPath: "/" },
      normalizedUrl: { path: "/", query: {} },
      routeId: "home",
      sources: {
        features: source({ leaderboardsEnabled: true }),
        notices: source({
          announcements: [],
          maintenance: { enabled: false, message: "" },
        }),
        terminals: source([terminal, mate]),
      },
    };
    const home = await render("https://ferry.fyi/", homeSnapshot);
    expect(home.markup).toContain("Clinton");
    expect(home.markup).toContain('data-public-ssr-freshness="terminals"');
    expect(home.markup).toContain("<time");
    expect(home.markup).toContain('href="/clinton"');
    expect(home.markup).toContain('href="/mukilteo"');
    expect(home.markup).not.toContain('href="/5"');
    const resolver = createStaticPublicSsrTerminalResolver();
    for (const href of ["/clinton", "/mukilteo"]) {
      expect(
        matchPublicSsrRoute(new URL(`https://ferry.fyi${href}`), resolver)
      ).toMatchObject({ canonicalPath: href });
    }
    ["terminals", "features", "notices"].forEach((sourceKey) =>
      expect(home.markup).toContain(`data-public-ssr-source="${sourceKey}"`)
    );
    expect(home.markup).not.toContain("Loading ferry routes and terminals");
  }, 15_000);

  it("renders Today from its anonymous seed", async () => {
    const { snapshot } = createPublicSsrFixtures();
    const todaySnapshot = createTodaySnapshot(snapshot);
    const today = await render("https://ferry.fyi/today", todaySnapshot);
    expect(today.markup).toContain("How Many Boats Are There Today?");
    expect(today.markup).toContain('data-public-ssr-freshness="schedule"');
    expect(today.markup).toContain("Page generated");
    expect(today.markup).not.toContain("Loading today&#x27;s boat count");
    for (const sourceKey of [
      "route",
      "schedule",
      "nextSchedule",
      "wsf",
      "notices",
    ]) {
      expect(today.markup).toContain(`data-public-ssr-source="${sourceKey}"`);
    }
  }, 15_000);

  it("renders the Today host profile from the same anonymous seed", async () => {
    const { snapshot } = createPublicSsrFixtures();
    const todaySnapshot = createTodaySnapshot(snapshot);
    const howManyBoatsToday = await render("https://howmanyboats.today/", {
      ...todaySnapshot,
      canonicalHost: "howmanyboats.today",
      canonicalPath: "/",
      hostProfile: "howmanyboats.today",
      metadata: { ...todaySnapshot.metadata, canonicalPath: "/" },
      normalizedUrl: { path: "/", query: {} },
    });
    expect(howManyBoatsToday.markup).toContain(
      "How Many Boats Are There Today?"
    );
    for (const sourceKey of [
      "route",
      "schedule",
      "nextSchedule",
      "wsf",
      "notices",
    ]) {
      expect(howManyBoatsToday.markup).toContain(
        `data-public-ssr-source="${sourceKey}"`
      );
    }
    expect(howManyBoatsToday.markup).not.toContain(
      "Loading ferry routes and terminals"
    );
  }, 15_000);

  it("renders public leaderboards from its anonymous seed", async () => {
    const { snapshot, source } = createPublicSsrFixtures();
    const leaderboardSnapshot = {
      ...snapshot,
      canonicalPath: "/leaderboards",
      metadata: { ...snapshot.metadata, canonicalPath: "/leaderboards" },
      normalizedUrl: { path: "/leaderboards", query: {} },
      routeId: "leaderboards",
      routeParams: {},
      sources: {
        features: source({ leaderboardsEnabled: true }),
        leaderboardIndex: source({
          defaultPeriod: "all",
          entities: [{ id: "5", kind: "terminal", label: "Clinton" }],
        }),
        notices: snapshot.sources.notices,
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
    const leaderboards = await render(
      "https://ferry.fyi/leaderboards",
      leaderboardSnapshot
    );
    ["features", "leaderboardIndex", "notices"].forEach((sourceKey) =>
      expect(leaderboards.markup).toContain(
        `data-public-ssr-source="${sourceKey}"`
      )
    );
  }, 15_000);
});
