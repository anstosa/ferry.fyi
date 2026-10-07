import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppRenderContextValue } from "../../client/lib/renderContext";
import type { Camera } from "../../shared/contracts/cameras";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";
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
  snapshot?: PublicSsrSnapshot
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

// public ssr fixtures
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
    info: {
      parking: "Use the public parking lot.",
      ada: "Accessible boarding is available.",
    },
    location: {
      address: {
        city: "Clinton",
        line1: "64 South Ferry Dock Road",
        line2: null,
        state: "WA",
        zip: "98236",
      },
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
    terminalUrl: "https://example.com/terminal",
    vesselWatchUrl: "https://example.com/vessel-watch",
    waitTimes: [
      {
        title: "Vehicle wait",
        description: "One sailing wait",
        time: 1785240000,
      },
    ],
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
      ad: source({
        creative: {
          advertiserName: "Island Coffee",
          body: "Coffee near the dock.",
          campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
          headline: "Fuel up before sailing",
          placementKey: "schedule--5--14",
          targetUrl: "https://example.com/menu",
        },
        placementKey: "schedule--5--14",
      }),
      alertGuidance: source({
        body: "Choose alerts after sign-in.",
        title: "Ferry alerts",
      }),
      bulletins: source([]),
      cameraFrames: source({ frames: {}, sourceUpdatedAt: null }),
      fares: source({
        catalog: {
          kind: "catalog",
          collectionDescription: "Fixture one-way collection",
          request: {
            arrivingTerminalId: "14",
            departingTerminalId: "5",
            roundTrip: false,
            tripDate: "2026-07-28",
          },
          freshness: {
            fetchedAt: 1785240000,
            sourceCacheFlushDate: null,
            validFrom: "2026-07-01",
            validThrough: "2026-09-30",
            policyVersion: "fixture",
          },
          fares: [
            {
              id: 1,
              label: "Adult passenger",
              category: "Passenger",
              amount: 10.5,
              directionIndependent: false,
            },
            {
              id: 2,
              label: "Vehicle and driver",
              category: "Vehicle",
              amount: 22,
              directionIndependent: true,
            },
          ],
        },
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
              arrivalTime: 1_753_705_200,
              weather: {
                cloudCoverPercent: 30,
                highTemperatureC: 22,
                precipitationMm: 0.5,
                temperatureC: 20,
                windGustKmh: 18,
                windSpeedKmh: 12,
              },
              tide: {
                stationId: "9447130",
                waterLevelM: 1.5,
                arrivalStationId: "9444900",
                arrivalWaterLevelM: 1.2,
                lowestWaterLevelM: 1.1,
              },
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
                confidence: "medium",
                source: "blended",
                sampleSize: 42,
                factors: [
                  {
                    detail: "Afternoon commuter demand",
                    impact: "higher",
                    label: "Commute",
                  },
                ],
                driveUpCapacity: 12,
                fullProbability: 0.46,
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

  it("renders ad content into the initial route HTML", async () => {
    const { snapshot } = createPublicSsrFixtures();

    const { markup } = await render("https://ferry.fyi/clinton", snapshot);

    expect(markup).toContain(
      'data-ad-campaign="5ed338e9-acbb-4cca-9380-1a923bfca5c8"'
    );
    expect(markup).toContain("Fuel up before sailing");
  }, 30_000);

  it("keeps the transition shell constrained to the scroll viewport", async () => {
    const { markup } = await render("https://ferry.fyi/about");

    expect(markup).toContain('class="flex h-full min-h-0 flex-col"');
    expect(markup).toContain('data-app-transition-shell="true"');
  }, 30_000);

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
    expect(markup).toContain('href="https://ballydidean.farm/donate"');
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
          text: "Vessel positions",
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
        // schedule content
        if (path === "/clinton") {
          expect(markup).toContain(
            "<h1>Clinton to Mukilteo Washington State Ferries schedule</h1>"
          );
          expect(markup).toContain("Departures from Clinton Ferry Terminal");
          expect(markup).toContain("arrive at Mukilteo Ferry Terminal");
          expect(markup).toContain('<time dateTime="2026-07-28"');
          expect(markup).toContain("July 28, 2026");
          expect(markup).not.toMatch(/today(?:'|&apos;)?s? schedule/i);
          expect(markup).not.toMatch(/live schedule/i);
          expect(markup).toContain('data-public-ssr-freshness="schedule"');
          expect(markup).toContain("<time");
          expect(markup).toContain("18 vehicle spaces reported");
          expect(markup).toContain("forecast full");
          expect(markup).not.toContain("forecast 12 vehicle spaces");
          expect(markup).toContain("Near capacity · 46% full risk");
          expect(markup).not.toContain("unlikely full risk");
          expect(markup).toContain("Dock change");
        }
        // terminal content
        if (path.endsWith("/terminal")) {
          expect(markup).toContain("<h1>Clinton Ferry Terminal</h1>");
          expect(markup).toContain("64 South Ferry Dock Road");
          expect(markup).toContain("Clinton, WA 98236");
          expect(markup).toContain("<h2>Facilities</h2>");
          expect(markup).toContain("Waiting room: available");
          expect(markup).toContain("Restrooms: available");
          expect(markup).toContain("Food: unavailable");
          expect(markup).toContain("Elevator: unavailable");
          expect(markup).toContain("Overhead passenger loading: unavailable");
          expect(markup).toContain("<h2>Routes</h2>");
          expect(markup).toContain("Mukilteo");
        }
        if (path.endsWith("/cameras")) {
          expect(markup).toContain('data-public-ssr-freshness="cameraFrames"');
        }
      } catch (error) {
        throw new Error(`${path}: ${String(error)}`);
      }
    }
  }, 15_000);

  it("renders camera freshness in the server-rendered image footer", async () => {
    const { snapshot, source, terminal } = createPublicSsrFixtures();
    const camera = {
      carCapacity: null,
      carsToBoat: null,
      id: "camera-1",
      image: {
        height: 245,
        url: "https://example.com/camera.jpg",
        width: 400,
      },
      isActive: true,
      location: { latitude: 47.9, longitude: -122.3 },
      owner: null,
      orderFromTerminal: 1,
      terminalId: terminal.id,
      title: "Holding lane",
    } satisfies Camera;
    const renderedAt = Date.parse(snapshot.renderedAt) / 1000;
    const cameraSnapshot: PublicSsrSnapshot = {
      ...snapshot,
      canonicalPath: "/clinton/mukilteo/cameras",
      metadata: {
        ...snapshot.metadata,
        canonicalPath: "/clinton/mukilteo/cameras",
      },
      normalizedUrl: {
        path: "/clinton/mukilteo/cameras",
        query: {},
      },
      routeId: "mate-cameras",
      sources: {
        ...snapshot.sources,
        cameraFrames: source({
          frames: {
            "camera-1": {
              cameraId: "camera-1",
              checkedAt: renderedAt,
              frameToken: "frame-1",
              frameUpdatedAt: renderedAt - 60,
              imageUrl: camera.image.url,
              isStale: false,
              status: "available",
            },
          },
          sourceUpdatedAt: renderedAt - 60,
        }),
        route: source({
          mate: snapshot.sources.route?.value?.mate,
          terminal: { ...terminal, cameras: [camera] },
        }),
      },
    };

    const { markup } = await render(
      "https://ferry.fyi/clinton/mukilteo/cameras",
      cameraSnapshot
    );

    expect(markup).toContain("Updated just now");
    expect(markup).toContain("WSDOT");
  });

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
    expect(home.markup).toContain('aria-label="Quick links"');
    expect(home.markup).toContain('href="/tickets"');
    expect(home.markup).toContain('href="/leaderboards"');
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
  it("exposes complete schedule, terminal, fare and vessel facts in semantic initial HTML", async () => {
    const { snapshot, source, terminal, mate } = createPublicSsrFixtures();
    const schedule = await render("https://ferry.fyi/clinton", snapshot);
    for (const text of [
      "Next service date",
      "2026-07-29",
      "Arrival",
      "Passengers: allowed",
      "Vehicles: allowed",
      "Confidence: medium",
      "42",
      "Afternoon commuter demand",
      "20°C",
      "12 km/h",
      "1.5 m",
      'aria-label="Route navigation"',
    ]) {
      expect(schedule.markup).toContain(text);
    }
    const details = await render(
      "https://ferry.fyi/clinton/terminal",
      snapshot
    );
    for (const text of [
      "Use the public parking lot.",
      "Accessible boarding is available.",
      "One sailing wait",
      "20 minutes",
      "https://example.com/terminal",
      "47.9",
    ]) {
      expect(details.markup).toContain(text);
    }
    const fare = await render(
      "https://ferry.fyi/clinton/mukilteo/fare",
      snapshot
    );
    expect(fare.markup).toMatch(
      /<section[^>]*aria-label="Fare estimator"[\s\S]*<\/section><details/
    );
    expect(fare.markup).toContain("Show full fare table");
    expect(fare.markup).toContain('data-fare-id="1"');
    expect(fare.markup).toContain('data-fare-id="2"');
    const vesselSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        route: source({ terminal, mate }),
        vessels: source([
          {
            id: "1",
            abbreviation: "TOK",
            name: "Tokitae",
            inService: true,
            inMaintenance: false,
            isAtDock: false,
            location: { latitude: 47.91, longitude: -122.31 },
            heading: 90,
            speed: 12,
          },
        ]),
      },
    } as PublicSsrSnapshot;
    const map = await render(
      "https://ferry.fyi/clinton/mukilteo/map",
      vesselSnapshot
    );
    for (const text of [
      "Tokitae",
      "In service: yes",
      "Maintenance: no",
      "Heading: 90°",
      "Speed: 12 knots",
      "47.910",
    ]) {
      expect(map.markup).toContain(text);
    }
  });
  // preserve exact direction and truthful provider units
  it("keeps multi-mate route facts and terminal links canonical", async () => {
    const { snapshot, source, terminal, mate } = createPublicSsrFixtures();
    const seeded = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        route: source({
          mate,
          terminal: {
            ...terminal,
            mates: [
              ...terminal.mates,
              { id: "3", name: "Other terminal", abbreviation: "OTH" },
            ],
            routes: {
              ...terminal.routes,
              unrelated: {
                id: "unrelated",
                terminalIds: ["5", "3"],
                description: "Unrelated crossing",
                crossingTime: 99,
              },
            },
          },
        }),
      },
    } as PublicSsrSnapshot;
    const schedule = await render("https://ferry.fyi/clinton/mukilteo", seeded);
    expect(schedule.markup).toContain('href="/clinton/terminal"');
    expect(schedule.markup).not.toContain('href="/clinton/mukilteo/terminal"');
    expect(schedule.markup).not.toContain("Unrelated crossing");
    expect(schedule.markup).toContain("m MLLW");
  });
});
