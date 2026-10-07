// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import {
  getPublicSsrSource,
  getPublicSsrSourceOutcome,
  PublicSsrSeedProvider,
  readPublicSsrSeed,
} from "../../client/lib/ssrSeed";
import {
  PublicAlertGuidance,
  PublicBulletins,
  PublicFares,
  PublicHome,
  PublicLeaderboards,
  PublicRouteMap,
} from "../../client/views/PublicSsrPages";
import { TicketsPublicPage } from "../../client/views/TicketsPublicContent";
import { PUBLIC_SSR_SNAPSHOT_VERSION } from "../../shared/contracts/ssr";
import { PUBLIC_SSR_SNAPSHOT_SCRIPT_ID } from "../../shared/contracts/ssrDocument";

const source = (value: unknown) => ({
  observedAt: "2026-07-28T12:00:00.000Z",
  outcome: "value",
  sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
  value,
});

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
    editorial: source({
      contentRevision: "test",
      release: { publishedAt: null, version: "test" },
    }),
    ticketGuidance: source({
      capabilities: {
        barcodeScanner: "available",
        savedTickets: "after-hydration",
        ticketLookup: "after-hydration",
      },
      guidance: { body: "Use your saved tickets.", title: "Tickets" },
    }),
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as import("../../shared/contracts/ssr").PublicSsrSnapshot;

// render one snapshot-backed public component
const renderSeeded = (element: React.ReactElement): string =>
  renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        HelmetProvider,
        null,
        React.createElement(PublicSsrSeedProvider, { snapshot }, element)
      )
    )
  );

describe("public SSR seeds", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads only versioned, anonymous snapshot data from the document", () => {
    document.body.innerHTML = `<script id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}" type="application/json">${JSON.stringify(snapshot)}</script>`;

    expect(readPublicSsrSeed(document)).toEqual(snapshot);

    document.querySelector("script")!.textContent = JSON.stringify({
      ...snapshot,
      accessToken: "must-not-render",
    });
    expect(readPublicSsrSeed(document)).toBeUndefined();
  });

  it("presents ticket guidance synchronously before ticket-native code loads", () => {
    const markup = renderSeeded(React.createElement(TicketsPublicPage));
    expect(markup).toContain("Ferry tickets, ready to scan");
    expect(markup).toContain("Scan a ticket code");
    expect(markup).toContain("No saved tickets yet");
  });

  it("presents seeded public leaderboard ranks, alert guidance, and vessel context", () => {
    const publicSnapshot = {
      ...snapshot,
      sources: {
        alertGuidance: source({
          body: "Choose a route after sign-in.",
          title: "Ferry alerts",
        }),
        leaderboard: source({
          entity: { id: "5", kind: "terminal", label: "Clinton" },
          entityId: "5",
          period: "week",
          ranks: [{ label: "Rider", rank: 1, score: 7 }],
        }),
        leaderboardIndex: source({ defaultPeriod: "week", entities: [] }),
        route: source({
          mate: {
            id: "14",
            name: "Mukilteo",
            location: { latitude: 47.95, longitude: -122.3 },
            mates: [{ id: "5", name: "Clinton" }],
          },
          terminal: {
            id: "5",
            name: "Clinton",
            location: { latitude: 47.9, longitude: -122.3 },
            mates: [{ id: "14", name: "Mukilteo" }],
          },
        }),
        vessels: source([
          {
            id: "vessel-1",
            location: { latitude: 47.9, longitude: -122.3 },
            name: "Kitsap",
          },
        ]),
      },
    };
    const render = (element: React.ReactElement) =>
      renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(
            PublicSsrSeedProvider,
            {
              snapshot:
                publicSnapshot as import("../../shared/contracts/ssr").PublicSsrSnapshot,
            },
            element
          )
        )
      );

    expect(render(React.createElement(PublicLeaderboards))).toContain(
      "1. Rider — 7"
    );
    expect(render(React.createElement(PublicAlertGuidance))).toContain(
      "Choose a route after sign-in."
    );
    expect(render(React.createElement(PublicRouteMap))).toContain(
      "Kitsap — 47.900, -122.300"
    );
  });

  it.each([
    [
      "value",
      {
        observedAt: "2026-07-28T12:00:00.000Z",
        outcome: "value",
        sourceUpdatedAt: "2026-07-28T11:00:00.000Z",
        value: [],
      },
      [],
    ],
    [
      "empty",
      {
        observedAt: "2026-07-28T12:00:00.000Z",
        outcome: "empty",
        sourceUpdatedAt: null,
        value: [],
      },
      undefined,
    ],
    [
      "stale-usable",
      {
        observedAt: "2026-07-28T12:00:00.000Z",
        outcome: "stale-usable",
        sourceUpdatedAt: "2026-07-27T12:00:00.000Z",
        value: [],
      },
      [],
    ],
    [
      "authoritatively-unavailable",
      {
        observedAt: "2026-07-28T12:00:00.000Z",
        outcome: "authoritatively-unavailable",
        reason: "source-unavailable",
        sourceUpdatedAt: null,
      },
      undefined,
    ],
  ] as const)(
    "preserves the raw %s source outcome without masquerading it as value data",
    (_name, outcome, expectedValue) => {
      const outcomeSnapshot = {
        ...snapshot,
        sources: { bulletins: outcome },
      } as import("../../shared/contracts/ssr").PublicSsrSnapshot;

      expect(getPublicSsrSourceOutcome(outcomeSnapshot, "bulletins")).toEqual(
        outcome
      );
      expect(getPublicSsrSource(outcomeSnapshot, "bulletins")).toEqual(
        expectedValue
      );
    }
  );

  it("renders authoritative-unavailable outcomes truthfully across dynamic public categories", () => {
    const unavailable = {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    };
    const publicSnapshot = {
      ...snapshot,
      sources: {
        alertGuidance: unavailable,
        bulletins: unavailable,
        fares: unavailable,
        features: unavailable,
        leaderboardIndex: unavailable,
        notices: unavailable,
        route: unavailable,
        terminals: unavailable,
        vessels: unavailable,
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
    const render = (element: React.ReactElement) =>
      renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot: publicSnapshot },
            element
          )
        )
      );

    const categories = [
      React.createElement(PublicHome),
      React.createElement(PublicFares),
      React.createElement(PublicRouteMap),
      React.createElement(PublicBulletins),
      React.createElement(PublicAlertGuidance),
      React.createElement(PublicLeaderboards),
    ];
    categories.forEach((category) => {
      const markup = render(category);
      expect(markup).toContain("source unavailable");
      expect(markup).toContain("Page generated");
    });
    expect(render(React.createElement(PublicBulletins))).not.toContain(
      "No active alerts"
    );
    expect(render(React.createElement(PublicFares))).toContain(
      "Official fare data is not available"
    );
  });

  it("renders the public home terminal directory in route groups", () => {
    const homeSnapshot = {
      ...snapshot,
      canonicalPath: "/",
      normalizedUrl: { path: "/", query: {} },
      routeId: "home",
      sources: {
        features: source({ leaderboardsEnabled: false }),
        terminals: source([
          {
            id: "3",
            name: "Bainbridge Island",
            location: { address: null, latitude: 47.6, longitude: -122.5 },
          },
          {
            id: "7",
            name: "Seattle",
            location: { address: null, latitude: 47.6, longitude: -122.3 },
          },
        ]),
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
    const markup = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot: homeSnapshot },
          React.createElement(PublicHome)
        )
      )
    );

    expect(markup).toContain('aria-label="Ferry terminals"');
    expect(markup).toContain(
      "Washington State Ferries schedules, terminal cameras, vehicle capacity forecasts, service alerts, fares, and vessel tracking."
    );
    expect(markup).toContain("Bainbridge Island");
  });
});
