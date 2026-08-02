import { readFileSync } from "node:fs";

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_SSR_EMPTY_DATA,
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrPayloadMap,
  type PublicSsrRouteSourceMap,
  type PublicSsrSnapshot,
  type PublicSsrTerminal,
} from "../../shared/contracts/ssr";
import type { PublicSsrRouteDefinition } from "../../shared/contracts/ssrRouting";
import { getNotFoundSeoMetadata, getSeoProfile } from "../../shared/lib/seo";
import {
  getNextSailingDayBoundary,
  getSailingDayId,
  SAILING_DAY_ZONE,
} from "../../shared/lib/ssrCachePolicy";
import { normalizePublicQuery } from "../../shared/lib/ssrQueryPolicy";
import { matchPublicSsrRoute } from "../../shared/lib/ssrRouteMatch";
import { PUBLIC_SSR_ROUTE_MANIFEST } from "../../shared/lib/ssrRoutes";
import { assertPublicSsrSnapshot } from "../../shared/lib/ssrValidation";

const terminal = {
  abbreviation: "SEA",
  bulletins: [],
  cameras: [],
  hasElevator: true,
  hasOverheadLoading: false,
  hasRestroom: true,
  hasWaitingRoom: true,
  hasFood: true,
  id: "1",
  info: {},
  location: {
    address: {
      city: "Seattle",
      line1: null,
      line2: null,
      state: "WA",
      zip: null,
    },
    latitude: 47.6,
    link: null,
    longitude: -122.3,
  },
  mates: [],
  name: "Seattle",
  popularity: 1,
  routes: {},
  terminalUrl: null,
  vesselWatchUrl: null,
  waitTimes: [],
} as const satisfies PublicSsrTerminal;
const resolver = {
  resolveSlug: (slug: string) => {
    if (slug === "sea" || slug === "seattle") {
      return { slug: "seattle", mateSlugs: ["bainbridge-island"] };
    }
    if (slug === "bainbridge-island") {
      return { slug, mateSlugs: ["seattle"] };
    }
    return undefined;
  },
};
const terminalSummary = {
  abbreviation: terminal.abbreviation,
  id: terminal.id,
  location: terminal.location,
  name: terminal.name,
} satisfies PublicSsrPayloadMap["terminals"][number];
const at = "2026-07-28T12:00:00.000Z";
const source = <T>(value: T) => ({
  outcome: "value" as const,
  observedAt: at,
  sourceUpdatedAt: at,
  value,
});
const scheduleVessel = {
  abbreviation: "KWS",
  id: "vessel-1",
  name: "Kitsap",
  speed: 1,
  tallVehicleCapacity: 1,
  vesselWatchUrl: "https://example.test/vessel",
  vehicleCapacity: 1,
} as PublicSsrPayloadMap["schedule"]["schedule"]["slots"][number]["vessel"];
const schedulePayload = {
  schedule: {
    date: "2026-07-28",
    key: "1-2",
    mateId: "2",
    slots: [
      {
        allowsPassengers: true,
        allowsVehicles: true,
        hasPassed: false,
        mateId: "2",
        time: 1,
        vessel: scheduleVessel,
        wuid: "wuid",
        crossing: {
          arrivalId: "2",
          departureDelta: null,
          departureId: "1",
          departureTime: 1,
          driveUpCapacity: 1,
          hasDriveUp: true,
          hasReservations: false,
          isCancelled: false,
          reservableCapacity: 1,
          totalCapacity: 2,
        },
        estimate: {
          confidence: "high",
          driveUpCapacity: 1,
          reservableCapacity: null,
        },
        tide: { stationId: "station", waterLevelM: null },
        weather: {
          cloudCoverPercent: null,
          highTemperatureC: null,
          precipitationMm: null,
          temperatureC: null,
          windGustKmh: null,
          windSpeedKmh: null,
        },
      },
    ],
    terminalId: "1",
    validRange: { from: 1, to: 2 },
    sourceUpdatedAt: 1,
  },
  timestamp: 1,
} satisfies PublicSsrPayloadMap["schedule"];
const routePayload = {
  mate: terminal,
  terminal,
} satisfies PublicSsrPayloadMap["route"];
const farePayload = {
  state: "current",
  catalog: {
    collectionDescription: null,
    fares: [
      {
        amount: 1,
        category: "adult",
        directionIndependent: false,
        id: 1,
        label: "Adult",
      },
    ],
    freshness: {
      fetchedAt: 1,
      policyVersion: "v1",
      sourceCacheFlushDate: null,
      validFrom: "2026-07-28",
      validThrough: "2026-07-29",
    },
    kind: "catalog",
    request: {
      arrivingTerminalId: "2",
      departingTerminalId: "1",
      roundTrip: false,
      tripDate: "2026-07-28",
    },
  },
} satisfies PublicSsrPayloadMap["fares"];
const noFarePayload = {
  state: "no-fare",
  noFare: {
    freshness: farePayload.catalog.freshness,
    kind: "no-fare",
    message: null,
    request: farePayload.catalog.request,
    sourceUrl: null,
  },
} satisfies PublicSsrPayloadMap["fares"];
const publicVessel = {
  abbreviation: "KWS",
  id: "vessel-1",
  inMaintenance: false,
  inService: true,
  name: "Kitsap",
  speed: 1,
} satisfies PublicSsrPayloadMap["vessels"][number];
const cameraPayload = {
  frames: {
    "camera-1": {
      cameraId: "camera-1",
      checkedAt: 1,
      frameToken: "public-frame",
      frameUpdatedAt: 1,
      imageUrl: "https://example.test/camera",
      isStale: false,
      status: "available",
    },
  },
  sourceUpdatedAt: 1,
} satisfies PublicSsrPayloadMap["cameraFrames"];
const editorial = {
  contentRevision: "rev",
  release: { publishedAt: at, version: "1" },
} satisfies PublicSsrPayloadMap["editorial"];
const ticketGuidance = {
  capabilities: {
    barcodeScanner: "available",
    savedTickets: "after-hydration",
    ticketLookup: "after-hydration",
  },
  guidance: { body: "Sign in after hydration", title: "Tickets" },
} satisfies PublicSsrPayloadMap["ticketGuidance"];
const leaderboard = {
  entity: { id: "1", kind: "terminal", label: "Seattle" },
  entityId: "1",
  period: "week",
  ranks: [{ label: "Seattle", rank: 1, score: 2 }],
} satisfies PublicSsrPayloadMap["leaderboard"];
const snapshot = (
  routeId: string,
  canonicalPath: string,
  sources: Record<string, unknown>,
  routeParams: Record<string, string> = {},
  query: Record<string, string> = {}
) => ({
  canonicalHost: "ferry.fyi",
  canonicalPath,
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath,
    description: "Ferry",
    robots: "index,follow",
    title: "Ferry FYI",
  },
  normalizedUrl: { path: canonicalPath, query },
  renderedAt: at,
  routeId,
  routeParams,
  sources,
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
});
const home = (): PublicSsrSnapshot => ({
  canonicalHost: "ferry.fyi",
  canonicalPath: "/",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/",
    description: "Ferry",
    robots: "index,follow",
    title: "Ferry FYI",
  },
  normalizedUrl: { path: "/", query: {} },
  renderedAt: at,
  routeId: "home",
  routeParams: {},
  sources: {
    terminals: source([terminalSummary]),
    features: source({ leaderboardsEnabled: true }),
    notices: source({
      announcements: [{ id: "weather", title: "Weather", body: "Wind" }],
      maintenance: { enabled: false, message: "" },
    }),
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
});

describe("SSR contracts", () => {
  it("keeps contracts free of SSR library imports", () => {
    expect(readFileSync("shared/contracts/ssr.ts", "utf8")).not.toMatch(
      /\.\.\/lib\/ssr/
    );
    expect(readFileSync("shared/contracts/ssrRouting.ts", "utf8")).not.toMatch(
      /\.\.\/lib\/ssr/
    );
  });
  it("uses exact keyed payload maps for every manifest route", () => {
    const matrix = {
      home: ["terminals", "features", "notices"],
      today: ["route", "schedule", "nextSchedule", "wsf", "notices"],
      "terminal-cameras": ["route", "cameraFrames", "notices"],
      "terminal-fares": ["route", "fares", "notices"],
      "terminal-map": ["route", "vessels", "notices"],
      "terminal-alerts": ["route", "bulletins", "notices"],
      "terminal-subscribe": ["route", "alertGuidance", "notices"],
      leaderboards: ["features", "notices", "leaderboard"],
    } as const satisfies Partial<
      Record<keyof PublicSsrRouteSourceMap, readonly string[]>
    >;
    for (const route of PUBLIC_SSR_ROUTE_MANIFEST) {
      expect(new Set(route.requiredSources).size).toBe(
        route.requiredSources.length
      );
    }
    expect(matrix["terminal-fares"]).toEqual(["route", "fares", "notices"]);
  });

  it("round-trips realistic anonymous public data and rejects loader-only or private data", () => {
    expect(assertPublicSsrSnapshot(home())).toMatchObject({ routeId: "home" });
    const privateCanary = home() as any;
    privateCanary.sources.terminals.value = [
      { ...terminalSummary, dataValues: {} },
    ];
    expect(() => assertPublicSsrSnapshot(privateCanary)).toThrow("dataValues");
    const transient = home() as any;
    transient.sources.notices = {
      outcome: "transiently-unavailable",
      observedAt: at,
      sourceUpdatedAt: null,
      reason: "warming",
    };
    expect(() => assertPublicSsrSnapshot(transient)).toThrow("sources");
    const missingTime = home() as any;
    delete missingTime.sources.features.observedAt;
    expect(() => assertPublicSsrSnapshot(missingTime)).toThrow("sources");
  });

  it("requires canonical empty payloads and preserves stale source timing", () => {
    const empty = home() as any;
    empty.sources.terminals = {
      outcome: "empty",
      observedAt: at,
      sourceUpdatedAt: null,
      value: PUBLIC_SSR_EMPTY_DATA.terminals,
    };
    expect(assertPublicSsrSnapshot(empty)).toBe(empty);
    empty.sources.terminals.value = [];
    expect(assertPublicSsrSnapshot(empty)).toBe(empty);
    empty.sources.features = {
      outcome: "stale-usable",
      observedAt: at,
      sourceUpdatedAt: "2025-01-01T00:00:00.000Z",
      value: { leaderboardsEnabled: true },
    };
    expect(assertPublicSsrSnapshot(empty)).toBe(empty);
  });

  it("validates every public payload family and only the closed public fare/camera forms", () => {
    const notices = source({
      announcements: [],
      maintenance: { enabled: false, message: "" },
    });
    const route = source(routePayload);
    const schedule = source(schedulePayload);
    const terminalSchedule = snapshot(
      "mate-schedule",
      "/seattle/bainbridge-island",
      {
        route,
        schedule,
        nextSchedule: schedule,
        wsf: source({ offline: false, coreReady: true }),
        bulletins: source([]),
        notices,
      },
      { terminalSlug: "seattle", mateSlug: "bainbridge-island" }
    );
    expect(assertPublicSsrSnapshot(terminalSchedule, resolver)).toBe(
      terminalSchedule
    );
    const cameras = snapshot(
      "terminal-cameras",
      "/seattle/cameras",
      { route, cameraFrames: source(cameraPayload), notices },
      { terminalSlug: "seattle" }
    );
    expect(assertPublicSsrSnapshot(cameras, resolver)).toBe(cameras);
    const fares = snapshot(
      "terminal-fares",
      "/seattle/fare",
      { route, fares: source(farePayload), notices },
      { terminalSlug: "seattle" }
    );
    expect(assertPublicSsrSnapshot(fares, resolver)).toBe(fares);
    const quote = structuredClone(fares) as Record<string, any>;
    fares.sources.fares = source(noFarePayload);
    expect(assertPublicSsrSnapshot(fares, resolver)).toBe(fares);
    const map = snapshot(
      "terminal-map",
      "/seattle/map",
      { route, vessels: source([publicVessel]), notices },
      { terminalSlug: "seattle" }
    );
    expect(assertPublicSsrSnapshot(map, resolver)).toBe(map);
    const alerts = snapshot(
      "terminal-alerts",
      "/seattle/alerts",
      { route, bulletins: source([]), notices },
      { terminalSlug: "seattle" }
    );
    expect(assertPublicSsrSnapshot(alerts, resolver)).toBe(alerts);
    const subscribe = snapshot(
      "terminal-subscribe",
      "/seattle/subscribe",
      {
        route,
        alertGuidance: source({
          title: "Alerts",
          body: "Sign in after hydration",
        }),
        notices,
      },
      { terminalSlug: "seattle" }
    );
    expect(assertPublicSsrSnapshot(subscribe, resolver)).toBe(subscribe);
    const tickets = snapshot("tickets", "/tickets", {
      editorial: source(editorial),
      ticketGuidance: source(ticketGuidance),
    });
    expect(assertPublicSsrSnapshot(tickets)).toBe(tickets);
    const boards = snapshot("leaderboards", "/leaderboards", {
      features: source({ leaderboardsEnabled: true }),
      notices,
      leaderboardIndex: source({
        defaultPeriod: "all",
        entities: [leaderboard.entity],
      }),
    });
    expect(assertPublicSsrSnapshot(boards)).toBe(boards);
    const board = snapshot(
      "leaderboards-terminal",
      "/leaderboards/terminals/1",
      {
        features: source({ leaderboardsEnabled: true }),
        notices,
        leaderboard: source(leaderboard),
      },
      { terminalId: "1" }
    );
    expect(assertPublicSsrSnapshot(board)).toBe(board);

    quote.sources.fares.value.catalog.quote = { kind: "quote" };
    expect(() => assertPublicSsrSnapshot(quote, resolver)).toThrow("quote");
    const errorCamera = structuredClone(cameras) as Record<string, any>;
    errorCamera.sources.cameraFrames.value.frames["camera-1"].error =
      "secret upstream exception";
    expect(() => assertPublicSsrSnapshot(errorCamera, resolver)).toThrow(
      "error"
    );
  });

  it("rejects unknown nested keys, invalid empty/outcomes, and private route source leaks", () => {
    const nested = structuredClone(home()) as Record<string, any>;
    nested.sources.terminals.value[0].location.extra = true;
    expect(() => assertPublicSsrSnapshot(nested)).toThrow("sources");
    const badEmpty = structuredClone(home()) as Record<string, any>;
    badEmpty.sources.terminals = {
      outcome: "empty",
      observedAt: at,
      sourceUpdatedAt: null,
      value: [terminal],
    };
    expect(() => assertPublicSsrSnapshot(badEmpty)).toThrow("sources");
    const unavailable = structuredClone(home()) as Record<string, any>;
    unavailable.sources.features = {
      outcome: "authoritatively-unavailable",
      observedAt: at,
      sourceUpdatedAt: null,
      reason: "source-unavailable",
      value: {},
    };
    expect(() => assertPublicSsrSnapshot(unavailable)).toThrow("sources");
    const callback = snapshot("callback", "/callback", {}, {});
    callback.indexability = "noindex";
    callback.metadata.robots = "noindex,follow";
    expect(assertPublicSsrSnapshot(callback)).toBe(callback);
    callback.sources = { editorial: source(editorial) };
    expect(() => assertPublicSsrSnapshot(callback)).toThrow("sources");
  });

  it("keeps the alternate host's external root distinct from its Today loader route", () => {
    const todaySources = {
      route: source(routePayload),
      schedule: source(schedulePayload),
      nextSchedule: source(schedulePayload),
      wsf: source({ offline: false }),
      notices: source({
        announcements: [],
        maintenance: { enabled: false, message: "" },
      }),
    };
    const alternateProfile = getSeoProfile("howmanyboats.today", "/");
    const alternate = snapshot("today", "/", todaySources);
    alternate.canonicalHost = "howmanyboats.today";
    alternate.hostProfile = "howmanyboats.today";
    alternate.metadata = {
      canonicalPath: alternateProfile.metadata.canonicalPath,
      description: alternateProfile.metadata.description,
      robots: alternateProfile.metadata.robots,
      title: alternateProfile.metadata.title,
    };
    expect(assertPublicSsrSnapshot(alternate)).toBe(alternate);

    const ferryProfile = getSeoProfile("ferry.fyi", "/today");
    const ferry = snapshot("today", "/today", todaySources);
    ferry.indexability = "noindex";
    ferry.metadata = {
      canonicalPath: ferryProfile.metadata.canonicalPath,
      description: ferryProfile.metadata.description,
      robots: ferryProfile.metadata.robots,
      title: ferryProfile.metadata.title,
    };
    expect(assertPublicSsrSnapshot(ferry)).toBe(ferry);

    const crossHostPath = structuredClone(alternate) as Record<string, any>;
    crossHostPath.canonicalPath = "/today";
    crossHostPath.normalizedUrl.path = "/today";
    crossHostPath.metadata.canonicalPath = "/today";
    expect(() => assertPublicSsrSnapshot(crossHostPath)).toThrow("coherence");
    const wrongMetadata = structuredClone(alternate) as Record<string, any>;
    wrongMetadata.metadata.title = ferryProfile.metadata.title;
    expect(() => assertPublicSsrSnapshot(wrongMetadata)).toThrow("coherence");
  });

  it("requires exact fixed 404 metadata on both public hosts", () => {
    const metadata = getNotFoundSeoMetadata();
    for (const host of ["ferry.fyi", "howmanyboats.today"] as const) {
      const notFound = {
        canonicalHost: host,
        canonicalPath: "/404",
        hostProfile: host,
        indexability: "noindex" as const,
        metadata: {
          canonicalPath: metadata.canonicalPath,
          description: metadata.description,
          robots: metadata.robots,
          title: metadata.title,
        },
        normalizedUrl: { path: "/404", query: {} },
        renderedAt: at,
        routeId: "unknown-public-path" as const,
        routeParams: {},
        sources: {},
        version: PUBLIC_SSR_SNAPSHOT_VERSION,
      };
      expect(assertPublicSsrSnapshot(notFound)).toBe(notFound);
      const mutated = structuredClone(notFound);
      mutated.metadata.title = "Request canary";
      expect(() => assertPublicSsrSnapshot(mutated)).toThrow("coherence");
    }
  });
});

describe("SSR matcher and query policy", () => {
  it("gives static paths precedence, canonicalizes aliases, and rejects malformed paths", () => {
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/today"), resolver)?.route
        .id
    ).toBe("today");
    expect(
      matchPublicSsrRoute(new URL("https://howmanyboats.today/"), resolver)
    ).toMatchObject({
      canonicalPath: "/",
      route: { id: "today", path: "/today" },
      routePath: "/today",
    });
    const mate = matchPublicSsrRoute(
      new URL("https://ferry.fyi/sea/bainbridge-island/cameras"),
      resolver
    );
    expect(mate).toMatchObject({
      canonicalPath: "/seattle/bainbridge-island/cameras",
      params: { terminalSlug: "seattle", mateSlug: "bainbridge-island" },
      route: { id: "mate-cameras" },
    });
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/today/"), resolver)
    ).toMatchObject({
      canonicalPath: "/404",
      route: { id: "unknown-public-path" },
    });
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/%2Fseattle"), resolver)
    ).toMatchObject({
      canonicalPath: "/404",
      params: {},
      route: { id: "unknown-public-path" },
    });
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/sea"))
    ).toBeUndefined();
  });
  it("keeps fare selectors out of public SSR query and cache identity", () => {
    const fareRoute = PUBLIC_SSR_ROUTE_MANIFEST.find(
      (item) => item.id === "terminal-fares"
    ) as PublicSsrRouteDefinition;
    expect(
      normalizePublicQuery(
        fareRoute,
        new URLSearchParams("fareAdults=02&fareMode=vehicle&tracking=x")
      )
    ).toEqual({ rejected: [], values: {} });
    expect(
      normalizePublicQuery(
        fareRoute,
        new URLSearchParams("fareAdults=2&fareAdults=3")
      )
    ).toEqual({ rejected: [], values: {} });
  });
});

describe("Pacific sailing-day policy", () => {
  it("changes at 3 AM Pacific and respects DST", () => {
    expect(
      getSailingDayId(
        DateTime.fromISO("2026-07-28T02:59:59", { zone: SAILING_DAY_ZONE })
      )
    ).toBe("2026-07-27");
    expect(
      getNextSailingDayBoundary(
        DateTime.fromISO("2026-03-08T00:30:00", { zone: SAILING_DAY_ZONE })
      ).toISO()
    ).toBe("2026-03-08T03:00:00.000-07:00");
  });
});
