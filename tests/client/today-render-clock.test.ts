// @vitest-environment jsdom
import { Settings } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getTerminal: vi.fn(),
}));

vi.mock("~/lib/schedule", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../client/lib/schedule")>();
  return { ...original, getSchedule: mocks.getSchedule };
});
vi.mock("~/lib/terminals", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../client/lib/terminals")>();
  return { ...original, getTerminal: mocks.getTerminal };
});

import { AppRenderProvider } from "../../client/lib/renderContext";
import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { Today } from "../../client/views/Today";
import type { Schedule, Slot } from "../../shared/contracts/schedules";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";

const slot = (id: string): Slot =>
  ({
    hasPassed: false,
    vessel: { id, name: id },
  }) as Slot;

const schedule = (date: string, vesselIds: string[]): Schedule =>
  ({
    date,
    key: date,
    mateId: "14",
    slots: vesselIds.map(slot),
    terminalId: "5",
    validRange: null,
  }) as Schedule;

const source = (value: unknown) => ({
  observedAt: "2026-07-29T04:59:00.000Z",
  outcome: "value" as const,
  sourceUpdatedAt: "2026-07-29T04:59:00.000Z",
  value,
});

const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/today",
  hostProfile: "ferry.fyi",
  indexability: "noindex",
  metadata: {
    canonicalPath: "/today",
    description: "Boat count",
    robots: "noindex,follow",
    title: "How Many Boats?",
  },
  normalizedUrl: { path: "/today", query: {} },
  renderedAt: "2026-07-29T04:59:00.000Z",
  routeId: "today",
  routeParams: {},
  sources: {
    notices: source({
      announcements: [],
      maintenance: { enabled: false, message: "" },
    }),
    nextSchedule: source({
      schedule: schedule("2026-07-29", ["Chelan", "Chelan"]),
      timestamp: 0,
    }),
    route: source({
      mate: { id: "14", name: "Mukilteo" },
      terminal: { id: "5", name: "Clinton" },
    }),
    schedule: source({
      schedule: schedule("2026-07-28", ["Tokitae", "Suquamish", "Tokitae"]),
      timestamp: 0,
    }),
    wsf: source({ offline: false }),
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as PublicSsrSnapshot;

const renderToday = (
  now: number,
  seededSnapshot: PublicSsrSnapshot = snapshot
): string =>
  renderToStaticMarkup(
    React.createElement(
      AppRenderProvider,
      {
        value: {
          clock: () => now,
          hasInjectedRequest: true,
          platform: "web",
          requestUrl: "https://ferry.fyi/today",
          runtime: "server",
          seoBaseUrl: "https://ferry.fyi",
          seoHost: "ferry.fyi",
          seoPathname: "/today",
        },
      },
      React.createElement(
        PublicSsrSeedProvider,
        { snapshot: seededSnapshot },
        React.createElement(
          HelmetProvider,
          null,
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/today"] },
            React.createElement(Today)
          )
        )
      )
    )
  );

describe("Today request clock", () => {
  const originalZone = Settings.defaultZone;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    Settings.defaultZone = originalZone;
    vi.clearAllMocks();
  });

  it("is deterministic across ambient process timezones", () => {
    const requestTime = Date.parse("2026-07-29T05:00:00.000Z");

    Settings.defaultZone = "UTC";
    const utcMarkup = renderToday(requestTime);
    Settings.defaultZone = "Asia/Tokyo";
    const tokyoMarkup = renderToday(requestTime);

    expect(tokyoMarkup).toBe(utcMarkup);
    expect(utcMarkup).toContain("But 1 tomorrow...");
  });

  it("uses the Pacific 22:00 boundary from the injected request clock", () => {
    Settings.defaultZone = "Asia/Tokyo";

    expect(renderToday(Date.parse("2026-07-29T04:59:59.999Z"))).not.toContain(
      "tomorrow"
    );
    expect(renderToday(Date.parse("2026-07-29T05:00:00.000Z"))).toContain(
      "But 1 tomorrow..."
    );
  });

  it("renders deterministic semantic snapshot freshness metadata", () => {
    const markup = renderToday(Date.parse("2026-07-29T05:00:00.000Z"));

    expect(markup).toContain('aria-label="Today source freshness"');
    expect(markup).toContain('data-public-ssr-freshness="schedule"');
    for (const sourceKey of [
      "route",
      "schedule",
      "nextSchedule",
      "wsf",
      "notices",
    ]) {
      expect(markup).toContain(`data-public-ssr-source="${sourceKey}"`);
    }
    expect(markup.match(/<time/g)).toHaveLength(6);
    expect(markup).toContain(
      '<time dateTime="2026-07-29T04:59:00.000Z">Jul 28, 9:59 PM PDT</time>'
    );
    expect(markup).toContain("Page generated");
  });

  it("describes each authoritative raw-source outcome without overstating freshness", () => {
    const matrixSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        nextSchedule: {
          observedAt: "2026-07-29T04:55:00.000Z",
          outcome: "authoritatively-unavailable",
          reason: "not-published",
          sourceUpdatedAt: null,
        },
        notices: {
          observedAt: "2026-07-29T04:58:00.000Z",
          outcome: "empty",
          sourceUpdatedAt: null,
          value: {
            announcements: [],
            maintenance: { enabled: false, message: "" },
          },
        },
        route: {
          observedAt: "2026-07-29T04:54:00.000Z",
          outcome: "authoritatively-unavailable",
          reason: "source-unavailable",
          sourceUpdatedAt: null,
        },
        schedule: {
          ...snapshot.sources.schedule,
          outcome: "stale-usable",
          sourceUpdatedAt: "2026-07-28T20:00:00.000Z",
        },
        wsf: {
          observedAt: "2026-07-29T04:56:00.000Z",
          outcome: "authoritatively-unavailable",
          reason: "not-supported",
          sourceUpdatedAt: null,
        },
      },
    } as PublicSsrSnapshot;
    const markup = renderToday(
      Date.parse("2026-07-29T05:00:00.000Z"),
      matrixSnapshot
    );

    expect(markup).toContain(
      "Clinton–Mukilteo route: source unavailable; checked"
    );
    expect(markup).toContain("Today&#x27;s schedule: stale public data from");
    expect(markup).toContain(
      "Tomorrow&#x27;s schedule: not published; checked"
    );
    expect(markup).toContain("WSF status: not supported; checked");
    expect(markup).toContain(
      "Service notices: no current public results; checked"
    );
    expect(markup).not.toContain("stale public data updated");
  });

  it("renders an authoritative unavailable boat-count state instead of loading", () => {
    const unavailableSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        schedule: {
          observedAt: "2026-07-29T04:59:00.000Z",
          outcome: "authoritatively-unavailable",
          reason: "source-unavailable",
          sourceUpdatedAt: null,
        },
      },
    } as PublicSsrSnapshot;
    const markup = renderToday(
      Date.parse("2026-07-29T05:00:00.000Z"),
      unavailableSnapshot
    );

    expect(markup).toContain("Boat count unavailable");
    expect(markup).toContain(
      "Today&#x27;s schedule: source unavailable; checked"
    );
    expect(markup).not.toContain("Loading today&#x27;s boat count");
  });

  it("retains snapshot freshness until a successful live schedule refresh", async () => {
    let resolveSchedule:
      | ((value: { schedule: Schedule; timestamp: number }) => void)
      | undefined;
    const currentSchedule = new Promise<{
      schedule: Schedule;
      timestamp: number;
    }>((resolve) => {
      resolveSchedule = resolve;
    });
    mocks.getSchedule
      .mockReturnValueOnce(currentSchedule)
      .mockResolvedValueOnce({
        schedule: schedule("2026-07-29", ["Chelan", "Chelan"]),
        timestamp: Date.parse("2026-07-29T06:00:00.000Z") / 1000,
      });
    const routeTerminal = {
      id: "5",
      mates: [{ id: "14" }],
      name: "Clinton",
    };
    const routeMate = { id: "14", mates: [], name: "Mukilteo" };
    mocks.getTerminal.mockImplementation((slug: string) =>
      Promise.resolve(slug === "clinton" ? routeTerminal : routeMate)
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          AppRenderProvider,
          {
            value: {
              clock: () => Date.parse("2026-07-29T05:00:00.000Z"),
              hasInjectedRequest: true,
              platform: "web",
              requestUrl: "https://ferry.fyi/today",
              runtime: "browser",
              seoBaseUrl: "https://ferry.fyi",
              seoHost: "ferry.fyi",
              seoPathname: "/today",
            },
          },
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot },
            React.createElement(
              HelmetProvider,
              null,
              React.createElement(
                MemoryRouter,
                { initialEntries: ["/today"] },
                React.createElement(Today)
              )
            )
          )
        )
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-public-ssr-source="schedule"]')?.innerHTML
    ).toContain("2026-07-29T04:59:00.000Z");
    expect(container.textContent).toContain("Page generated");

    await act(async () => {
      resolveSchedule?.({
        schedule: schedule("2026-07-28", ["Tokitae", "Suquamish", "Tokitae"]),
        timestamp: Date.parse("2026-07-29T05:30:00.000Z") / 1000,
      });
      await currentSchedule;
      await Promise.resolve();
      await Promise.resolve();
    });

    const liveSchedule = container.querySelector(
      '[data-public-ssr-source="schedule"]'
    );
    expect(liveSchedule?.innerHTML).toContain("2026-07-29T05:30:00.000Z");
    expect(liveSchedule?.innerHTML).not.toContain("2026-07-29T04:59:00.000Z");
    expect(
      container.querySelector('[data-public-ssr-source="nextSchedule"]')
        ?.innerHTML
    ).toContain("2026-07-29T06:00:00.000Z");
    expect(
      container.querySelector('[data-public-ssr-source="route"]')?.innerHTML
    ).toContain("2026-07-29T04:59:00.000Z");
    expect(container.textContent).not.toContain("Page generated");
  });
});
