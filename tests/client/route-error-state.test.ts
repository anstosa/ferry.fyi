// @vitest-environment jsdom

import { DateTime, Settings } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const getTerminal = vi.hoisted(() => vi.fn());
const getSchedule = vi.hoisted(() => vi.fn());
const refreshSchedule = vi.hoisted(() => vi.fn());
const dateButton = vi.hoisted(() => ({
  onDateChange: undefined as undefined | ((date: DateTime) => void),
}));
const observeHeaderProps = vi.hoisted(() => vi.fn());
const observeScheduleProps = vi.hoisted(() => vi.fn());
const bulletinRefresh = vi.hoisted(() => ({
  onTerminalRefresh: undefined as
    | ((terminal: {
        bulletins?: unknown[];
        id: string;
        waitTimes?: Array<{ description: string }>;
      }) => void)
    | undefined,
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  getTerminal,
}));
vi.mock("~/lib/schedule", () => ({
  getSchedule,
  getScheduleCheckedAt: ({ timestamp }: { timestamp?: number }) =>
    Number.isFinite(timestamp) ? timestamp : null,
  refreshSchedule,
  requireScheduleResponse: (value: unknown) => value,
}));
vi.mock("~/lib/favoriteRoutes", () => ({
  isFavoriteRoute: () => false,
  useFavoriteRoutes: () => [[], vi.fn()],
}));
vi.mock("~/components/Page", () => ({
  Page: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/PageLoadError", () => ({
  PageLoadError: ({
    onReload,
    title,
  }: {
    onReload: () => void;
    title: string;
  }) =>
    React.createElement(
      "section",
      undefined,
      title,
      React.createElement("button", { onClick: onReload }, "Retry")
    ),
}));
vi.mock("~/components/RouteLoadingState", () => ({
  RouteLoadingState: () => React.createElement("p", undefined, "Loading route"),
}));
vi.mock("~/components/Footer", () => ({ Footer: () => null }));
vi.mock("~/components/DateButton", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../client/components/DateButton")>();
  return {
    ...actual,
    // expose the callback without hiding the real mount behavior
    DateButton: (
      props: React.ComponentProps<typeof actual.DateButton>
    ): React.ReactElement => {
      dateButton.onDateChange = props.onDateChange;
      return React.createElement(actual.DateButton, props);
    },
  };
});
vi.mock("~/components/RouteSelector", () => ({ RouteSelector: () => null }));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/views/Header", () => ({
  // capture the schedule share contract
  Header: ({
    children,
    share,
  }: {
    children: React.ReactNode;
    share?: ShareOptions;
  }) => {
    observeHeaderProps({ share });
    return children;
  },
}));
vi.mock("../../client/views/Schedule", () => ({
  Schedule: ({
    checkedAt,
    departureTerminal,
    onRefresh,
    schedule,
    selectedDate,
    time,
  }: {
    checkedAt?: number | null;
    departureTerminal?: {
      bulletins?: unknown[];
      waitTimes?: Array<{ description: string }>;
    };
    onRefresh?: () => Promise<void>;
    schedule: {
      date: string;
      sourceUpdatedAt?: number | null;
      terminalId: string;
    } | null;
    selectedDate?: string;
    time: DateTime;
  }) => {
    // capture the route-to-schedule date and clock contract
    observeScheduleProps({ selectedDate, time });
    return React.createElement(
      React.Fragment,
      undefined,
      React.createElement(
        "p",
        {
          "data-checked-at": checkedAt ?? "",
          "data-departure-bulletin-count":
            departureTerminal?.bulletins?.length ?? "",
          "data-departure-wait":
            departureTerminal?.waitTimes?.[0]?.description ?? "",
          "data-selected-date": selectedDate ?? "",
          "data-source-updated-at": schedule?.sourceUpdatedAt ?? "",
          "data-time": time.toISO() ?? "",
        },
        schedule
          ? `Schedule ${schedule.terminalId} ${schedule.date}`
          : "Empty schedule"
      ),
      onRefresh
        ? React.createElement(
            "button",
            { onClick: () => onRefresh().catch(() => undefined) },
            "Check schedule"
          )
        : null
    );
  },
}));
vi.mock("../../client/views/Map", () => ({
  Map: ({
    terminal,
    vesselIdentity,
    vessels,
  }: {
    terminal: { name: string } | null;
    vesselIdentity: string;
    vessels: Array<{ name: string }>;
  }) =>
    React.createElement(
      "p",
      undefined,
      `Map ${terminal?.name ?? "empty"} ${vesselIdentity || "seeded"} ${vessels
        .map(({ name }) => name)
        .join(",")}`
    ),
}));
vi.mock("../../client/views/Cameras", () => ({
  Cameras: ({ terminal }: { terminal: { name: string } | null }) =>
    React.createElement("p", undefined, `Cameras ${terminal?.name ?? "empty"}`),
}));
vi.mock("../../client/views/Fares", () => ({
  Fares: ({ terminal }: { terminal: { name: string } }) =>
    React.createElement("p", undefined, `Fares ${terminal.name}`),
}));
vi.mock("../../client/views/Bulletins", () => ({
  Bulletins: ({
    onTerminalRefresh,
    terminal,
  }: {
    onTerminalRefresh?: typeof bulletinRefresh.onTerminalRefresh;
    terminal: { name: string } | null;
  }) => {
    // expose accepted alert refreshes to the route owner
    bulletinRefresh.onTerminalRefresh = onTerminalRefresh;
    return React.createElement(
      "p",
      undefined,
      `Alerts ${terminal?.name ?? "empty"}`
    );
  },
}));

import { AppRenderProvider } from "../../client/lib/renderContext";
import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { Route } from "../../client/views/Route";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";
import { getRecommendationServiceDate } from "../../shared/lib/sailingRecommendationRevision";

let root: Root | undefined;
const originalZone = Settings.defaultZone;
afterEach(() => {
  act(() => root?.unmount());
  // restore real clock
  vi.useRealTimers();
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  dateButton.onDateChange = undefined;
  bulletinRefresh.onTerminalRefresh = undefined;
  Settings.defaultZone = originalZone;
  vi.clearAllMocks();
});

const renderRoute = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/terminal-a/terminal-b"] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(RouterRoute, {
            path: "/:terminalSlug/:mateSlug",
            element: React.createElement(Route, { view: "schedule" }),
          })
        )
      )
    );
    await Promise.resolve();
  });
  return container;
};

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

// mirror the Route default across the pacific 03:00 boundary
function getCurrentServiceDate(): string {
  return getRecommendationServiceDate(Date.now() / 1000);
}

const getView = (
  pathname: string
): "alerts" | "cameras" | "fare" | "map" | "schedule" => {
  // match the camera tab before the default schedule branch
  if (pathname.endsWith("/cameras")) {
    return "cameras";
  }
  // match the fare tab before the default schedule branch
  if (pathname.endsWith("/fare")) {
    return "fare";
  }
  if (pathname.endsWith("/map")) {
    return "map";
  }
  if (pathname.endsWith("/alerts")) {
    return "alerts";
  }
  return "schedule";
};

interface NavigationController {
  currentPath?: string;
  navigate: (path: string) => void;
}

// navigable route render
const renderNavigableRoute = async (
  controller: NavigationController,
  initialEntry = "/terminal-a/terminal-b"
) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // route harness
  const Harness = () => {
    const navigate = useNavigate();
    const { pathname, search, hash } = useLocation();
    controller.navigate = navigate;
    controller.currentPath = `${pathname}${search}${hash}`;
    return React.createElement(Route, { view: getView(pathname) });
  };
  await act(async () => {
    root?.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        React.createElement(
          Routes,
          undefined,
          React.createElement(RouterRoute, {
            element: React.createElement(Harness),
            path: "/:terminalSlug/:mateSlug/*",
          })
        )
      )
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
};

const renderSeededRoute = async ({
  clock = () => Date.now(),
  initialEntry,
  scheduleDate,
  scheduleTimestamp = 0,
  seededVessels = [],
  syncWindowLocation = false,
  view,
}: {
  clock?: () => number;
  initialEntry?: string;
  scheduleDate?: string;
  scheduleTimestamp?: number;
  seededVessels?: unknown[];
  syncWindowLocation?: boolean;
  view: "map" | "schedule";
}) => {
  const date = scheduleDate ?? getCurrentServiceDate();
  const terminal = {
    id: "terminal-a",
    mates: [{ id: "terminal-b", name: "B" }],
    name: "A",
    routes: {},
  };
  const mate = {
    id: "terminal-b",
    mates: [{ id: "terminal-a", name: "A" }],
    name: "B",
    routes: {},
  };
  const source = (value: unknown) => ({
    observedAt: "2026-07-30T12:00:00.000Z",
    outcome: "value" as const,
    sourceUpdatedAt: "2026-07-30T12:00:00.000Z",
    value,
  });
  const pathSuffix = view === "map" ? "/map" : "";
  const routePath = `/terminal-a/terminal-b${pathSuffix}`;
  const routeEntry = initialEntry ?? routePath;
  const routeUrl = new URL(routeEntry, "https://ferry.fyi");
  const snapshot = {
    canonicalHost: "ferry.fyi",
    canonicalPath: routePath,
    hostProfile: "ferry.fyi",
    indexability: "indexable",
    metadata: {
      canonicalPath: `/terminal-a/terminal-b${pathSuffix}`,
      description: view === "map" ? "Map" : "Schedule",
      robots: "index,follow",
      title: view === "map" ? "Map" : "Schedule",
    },
    normalizedUrl: {
      path: routePath,
      query: Object.fromEntries(routeUrl.searchParams),
    },
    renderedAt: "2026-07-30T12:00:00.000Z",
    routeId: view === "map" ? "mate-map" : "mate-schedule",
    routeParams: {
      mateSlug: "terminal-b",
      terminalSlug: "terminal-a",
    },
    sources: {
      route: source({ mate, terminal }),
      schedule: source({
        schedule: {
          date,
          mateId: mate.id,
          slots: seededVessels.map((vessel) => ({ vessel })),
          sourceUpdatedAt: 1,
          terminalId: terminal.id,
        },
        timestamp: scheduleTimestamp,
      }),
      vessels: source(seededVessels),
    },
    version: PUBLIC_SSR_SNAPSHOT_VERSION,
  } as PublicSsrSnapshot;
  // align the browser URL when the assertion covers query cleanup
  if (syncWindowLocation) {
    window.history.replaceState(null, "", routeEntry);
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      React.createElement(
        AppRenderProvider,
        {
          value: {
            clock,
            hasInjectedRequest: false,
            platform: "web",
            requestUrl: routeUrl.toString(),
            runtime: "browser",
            seoBaseUrl: "https://ferry.fyi",
            seoHost: "ferry.fyi",
            seoPathname: routeUrl.pathname,
          },
        },
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot },
          React.createElement(
            MemoryRouter,
            { initialEntries: [routeEntry] },
            React.createElement(
              Routes,
              undefined,
              React.createElement(RouterRoute, {
                path: `/:terminalSlug/:mateSlug${pathSuffix}`,
                element: React.createElement(Route, { view }),
              })
            )
          )
        )
      )
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, date };
};

const renderSeededMapRoute = (seededVessels: unknown[]) =>
  renderSeededRoute({ seededVessels, view: "map" });

describe("Route route-load errors", () => {
  // canonicalizing an initial alias must not discard its in-page destination
  it("preserves the fragment while resolving a route alias", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [{ id: "terminal-b" }, { id: "terminal-c" }],
      name: "A",
      routes: {},
    };
    const mate = { id: "terminal-b", mates: [], name: "B", routes: {} };
    // serve the same resolved terminals before and after canonical navigation
    getTerminal.mockImplementation((slug: string) =>
      Promise.resolve(slug === mate.id ? mate : terminal)
    );
    getSchedule.mockReturnValue(new Promise(() => undefined));
    const controller: NavigationController = { navigate: () => undefined };
    await renderNavigableRoute(
      controller,
      "/old-terminal/terminal-b#terminal-parking"
    );
    expect(controller.currentPath).toBe(
      "/terminal-a/terminal-b#terminal-parking"
    );
  });

  // schedule owner boundary
  it("provides the schedule share contract to Header", async () => {
    getSchedule.mockReturnValue(new Promise(() => undefined));

    await renderSeededRoute({ view: "schedule" });

    expect(observeHeaderProps).toHaveBeenLastCalledWith({
      share: {
        shareButtonText: "Share Schedule",
        sharedText: "Schedule for A to B",
        shareSurface: "schedule",
      },
    });
  });

  // pacific service-day boundary
  it.each([
    ["2026-10-07T09:59:59.000Z", "2026-10-06"],
    ["2026-10-07T10:00:00.000Z", "2026-10-07"],
  ])(
    "defaults an undated seeded route at %s to service date %s",
    async (instant, expectedDate) => {
      const now = Date.parse(instant);
      getSchedule.mockReturnValue(new Promise(() => undefined));

      const { container } = await renderSeededRoute({
        clock: () => now,
        scheduleDate: expectedDate,
        view: "schedule",
      });

      expect(
        container
          .querySelector("[data-selected-date]")
          ?.getAttribute("data-selected-date")
      ).toBe(expectedDate);
      expect(getSchedule.mock.calls[0]?.[2].toISODate()).toBe(expectedDate);
    }
  );

  // ambient-zone independence
  it.each([
    ["UTC", "/terminal-a/terminal-b"],
    ["Asia/Tokyo", "/terminal-a/terminal-b?date=not-a-date"],
  ])(
    "defaults an absent or invalid date in %s to the Pacific service date",
    async (zone, initialEntry) => {
      Settings.defaultZone = zone;
      const now = Date.parse("2026-10-07T09:59:59.000Z");
      getSchedule.mockReturnValue(new Promise(() => undefined));

      const { container } = await renderSeededRoute({
        clock: () => now,
        initialEntry,
        scheduleDate: "2026-10-06",
        syncWindowLocation: true,
        view: "schedule",
      });

      expect(
        container
          .querySelector("[data-selected-date]")
          ?.getAttribute("data-selected-date")
      ).toBe("2026-10-06");
      expect(window.location.search).not.toContain("date=");
    }
  );

  // injected instant precision
  it("passes the full injected instant to the first Schedule render", async () => {
    const now = Date.parse("2026-10-07T09:59:42.123Z");
    getSchedule.mockReturnValue(new Promise(() => undefined));

    await renderSeededRoute({
      clock: () => now,
      scheduleDate: "2026-10-06",
      view: "schedule",
    });

    const firstTime = observeScheduleProps.mock.calls[0]?.[0].time as DateTime;
    expect(firstTime.toMillis()).toBe(now);
    expect(firstTime.zoneName).toBe("America/Los_Angeles");
  });

  // fixed explicit selection
  it("keeps an explicit date fixed across the service-day rollover", async () => {
    vi.useFakeTimers();
    Settings.defaultZone = "Asia/Tokyo";
    let now = Date.parse("2026-10-07T09:59:55.000Z");
    getSchedule.mockReturnValue(new Promise(() => undefined));
    const { container } = await renderSeededRoute({
      clock: () => now,
      initialEntry: "/terminal-a/terminal-b?date=2026-10-05",
      scheduleDate: "2026-10-05",
      syncWindowLocation: true,
      view: "schedule",
    });

    now = Date.parse("2026-10-07T10:00:05.000Z");
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-selected-date]")
        ?.getAttribute("data-selected-date")
    ).toBe("2026-10-05");
    expect(window.location.search).toBe("?date=2026-10-05");
  });

  // live service-day rollover
  it("advances an undated route at 03:00 without adding a date query", async () => {
    vi.useFakeTimers();
    let now = Date.parse("2026-10-07T09:59:55.000Z");
    getSchedule.mockReturnValue(new Promise(() => undefined));
    const { container } = await renderSeededRoute({
      clock: () => now,
      scheduleDate: "2026-10-06",
      syncWindowLocation: true,
      view: "schedule",
    });

    now = Date.parse("2026-10-07T10:00:05.000Z");
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-selected-date]")
        ?.getAttribute("data-selected-date")
    ).toBe("2026-10-07");
    expect(window.location.pathname).toBe("/terminal-a/terminal-b");
    expect(window.location.search).toBe("");
  });

  // current-day reset
  it("resets an off-date tab to the current Pacific service day", async () => {
    const now = Date.parse("2026-10-07T09:59:59.000Z");
    getSchedule.mockReturnValue(new Promise(() => undefined));
    const { container } = await renderSeededRoute({
      clock: () => now,
      initialEntry: "/terminal-a/terminal-b/map?date=2026-10-05",
      scheduleDate: "2026-10-05",
      syncWindowLocation: true,
      view: "map",
    });
    const goToToday = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Go to today"
    );

    await act(async () => {
      goToToday?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const requestedDate = getSchedule.mock.calls.at(-1)?.[2] as DateTime;
    expect(requestedDate.toISODate()).toBe("2026-10-06");
    expect(window.location.search).toBe("");
    expect(container.textContent).toContain("Map A");
  });

  it("updates the browser URL when the selected schedule date changes", async () => {
    // keep selected date off today
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00-07:00"));
    const terminal = {
      id: "terminal-a",
      mates: [{ id: "terminal-b" }, { id: "terminal-c" }],
      name: "A",
      routes: {},
    };
    const mate = { id: "terminal-b", mates: [], name: "B", routes: {} };
    getTerminal.mockResolvedValueOnce(terminal).mockResolvedValueOnce(mate);
    getSchedule.mockResolvedValue({
      schedule: {
        date: getCurrentServiceDate(),
        mateId: mate.id,
        slots: [],
        terminalId: terminal.id,
      },
      timestamp: 0,
    });
    window.history.replaceState(
      null,
      "",
      "/terminal-a/terminal-b?farePassengers=2#sailings"
    );
    await renderNavigableRoute({ navigate: () => undefined });

    await act(async () => {
      dateButton.onDateChange?.(DateTime.fromISO("2026-08-20"));
      await Promise.resolve();
    });

    expect(window.location.href).toBe(
      "http://localhost:3000/terminal-a/terminal-b?farePassengers=2&date=2026-08-20#sailings"
    );
  });

  it("uses the seeded response check time during hydration", async () => {
    getSchedule.mockReturnValue(deferred().promise);

    const { container } = await renderSeededRoute({
      scheduleTimestamp: 2_000_000_000,
      view: "schedule",
    });
    const scheduleView = container.querySelector("[data-checked-at]");

    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000000");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("1");
  });

  it("tracks GET and manual POST check times without changing source freshness", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [
        { id: "terminal-b", name: "B" },
        { id: "terminal-c", name: "C" },
      ],
      name: "A",
      routes: {},
    };
    const mate = {
      id: "terminal-b",
      mates: [{ id: "terminal-a", name: "A" }],
      name: "B",
      routes: {},
    };
    const schedule = {
      date: getCurrentServiceDate(),
      mateId: mate.id,
      slots: [],
      sourceUpdatedAt: 1,
      terminalId: terminal.id,
    };
    getTerminal.mockImplementation((id: string) =>
      Promise.resolve(id === terminal.id ? terminal : mate)
    );
    getSchedule.mockResolvedValue({ schedule, timestamp: 2_000_000_000 });
    refreshSchedule.mockResolvedValue({ schedule, timestamp: 2_000_000_001 });

    const container = await renderNavigableRoute({
      navigate: () => undefined,
    });
    const scheduleView = container.querySelector("[data-checked-at]");

    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000000");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("1");

    const checkButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Check schedule"
    );
    await act(async () => {
      checkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000001");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("1");
  });

  // keep an older same-route GET from replacing a newer cache refresh
  it("retains a newer refreshed schedule after an older GET resolves", async () => {
    const olderGet = deferred<{
      schedule: {
        date: string;
        mateId: string;
        slots: [];
        sourceUpdatedAt: number;
        terminalId: string;
      };
      timestamp: number;
    }>();
    const newerRefresh = deferred<{
      schedule: {
        date: string;
        mateId: string;
        slots: [];
        sourceUpdatedAt: number;
        terminalId: string;
      };
      timestamp: number;
    }>();
    getSchedule.mockReturnValue(olderGet.promise);
    refreshSchedule.mockReturnValue(newerRefresh.promise);
    const { container, date } = await renderSeededRoute({
      scheduleTimestamp: 2_000_000_000,
      view: "schedule",
    });
    const scheduleView = container.querySelector("[data-checked-at]");
    const checkButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Check schedule"
    );

    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000000");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("1");
    await act(async () => {
      checkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(refreshSchedule).toHaveBeenCalledTimes(1);

    await act(async () => {
      newerRefresh.resolve({
        schedule: {
          date,
          mateId: "terminal-b",
          slots: [],
          sourceUpdatedAt: 3,
          terminalId: "terminal-a",
        },
        timestamp: 2_000_000_003,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000003");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("3");

    await act(async () => {
      olderGet.resolve({
        schedule: {
          date,
          mateId: "terminal-b",
          slots: [],
          sourceUpdatedAt: 2,
          terminalId: "terminal-a",
        },
        timestamp: 2_000_000_002,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scheduleView?.getAttribute("data-checked-at")).toBe("2000000003");
    expect(scheduleView?.getAttribute("data-source-updated-at")).toBe("3");
    expect(container.textContent).not.toContain(
      "Could not refresh the schedule. Showing saved data."
    );
  });

  it("retains seeded assignment A when the exact-route live schedule fails", async () => {
    const liveSchedule = deferred<never>();
    getSchedule.mockReturnValue(liveSchedule.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { container } = await renderSeededMapRoute([
      { id: "a", name: "Vessel A" },
    ]);

    expect(container.textContent).toContain("Vessel A");
    expect(container.textContent).toContain("seeded");

    await act(async () => {
      liveSchedule.reject(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Vessel A");
    expect(container.textContent).toContain("seeded");
    consoleError.mockRestore();
  });

  it.each([
    ["seeded A", [{ id: "a", name: "Vessel A" }]],
    ["an empty seed", []],
  ])("replaces %s with exact live assignment B", async (_label, seed) => {
    const liveSchedule = deferred<{
      schedule: {
        date: string;
        mateId: string;
        slots: Array<{ vessel: { id: string; name: string } }>;
        terminalId: string;
      };
      timestamp: number;
    }>();
    getSchedule.mockReturnValue(liveSchedule.promise);
    const { container, date } = await renderSeededMapRoute(seed);

    if (seed.length > 0) {
      expect(container.textContent).toContain("Vessel A");
    }
    expect(container.textContent).toContain("seeded");

    await act(async () => {
      liveSchedule.resolve({
        schedule: {
          date,
          mateId: "terminal-b",
          slots: [{ vessel: { id: "b", name: "Vessel B" } }],
          terminalId: "terminal-a",
        },
        timestamp: 2_000_000_000,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Vessel B");
    expect(container.textContent).not.toContain("Vessel A");
    expect(container.textContent).not.toContain("seeded");
  });

  it("honors an authoritative empty live assignment after seeded A", async () => {
    const liveSchedule = deferred<{
      schedule: {
        date: string;
        mateId: string;
        slots: [];
        terminalId: string;
      };
      timestamp: number;
    }>();
    getSchedule.mockReturnValue(liveSchedule.promise);
    const { container, date } = await renderSeededMapRoute([
      { id: "a", name: "Vessel A" },
    ]);
    expect(container.textContent).toContain("Vessel A");

    await act(async () => {
      liveSchedule.resolve({
        schedule: {
          date,
          mateId: "terminal-b",
          slots: [],
          terminalId: "terminal-a",
        },
        timestamp: 2_000_000_000,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Vessel A");
    expect(container.textContent).not.toContain("seeded");
  });

  it("shows the route error before the route loading state", async () => {
    getTerminal.mockRejectedValue(new Error("offline"));
    const container = await renderRoute();

    expect(container.textContent).toContain("Route could not load");
    expect(container.textContent).not.toContain("Loading route");
  });

  it("clears a route error when retry resolves the route", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [{ id: "terminal-b", mates: [] }],
      name: "A",
      routes: {},
    };
    const mate = terminal.mates[0];
    getTerminal
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(mate);
    getSchedule.mockResolvedValue({
      schedule: {
        date: "2026-07-27",
        mateId: "terminal-b",
        slots: [],
        terminalId: "terminal-a",
      },
      timestamp: 0,
    });
    const container = await renderRoute();
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry"
    );

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getTerminal).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("Route could not load");
  });

  it.each(["map", "alerts"] as const)(
    "retains terminal facts while replacing the same-pair tab with %s",
    async (view) => {
      const terminal = {
        id: "terminal-a",
        mates: [{ id: "terminal-b" }, { id: "terminal-c" }],
        name: "A",
        routes: {},
      };
      const mate = { id: "terminal-b", mates: [], name: "B", routes: {} };
      getTerminal.mockResolvedValueOnce(terminal).mockResolvedValueOnce(mate);
      getSchedule.mockResolvedValue({
        schedule: {
          date: getCurrentServiceDate(),
          mateId: mate.id,
          slots: [],
          terminalId: terminal.id,
        },
        timestamp: 0,
      });
      const controller: NavigationController = {
        navigate: () => undefined,
      };
      const container = await renderNavigableRoute(controller);
      expect(container.textContent).toContain("Schedule terminal-a");

      const nextTerminal = deferred<typeof terminal>();
      getTerminal.mockReturnValue(nextTerminal.promise);
      await act(async () => {
        controller.navigate(`/terminal-a/terminal-b/${view}`);
        await Promise.resolve();
      });

      expect(container.textContent).not.toContain("Loading route");
      expect(container.textContent).not.toContain("Schedule terminal-a");
      expect(container.textContent).toContain(
        view === "map" ? "Map A" : "Alerts A"
      );
      expect(getTerminal).toHaveBeenCalledTimes(2);
    }
  );

  // follow the visual bar when moving from fares back to cameras
  it("animates fare-to-camera navigation toward the left", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [{ id: "terminal-b" }, { id: "terminal-c" }],
      name: "A",
      routes: {},
    };
    const mate = {
      id: "terminal-b",
      mates: [{ id: "terminal-a" }],
      name: "B",
      routes: {},
    };
    getTerminal.mockImplementation((id: string) =>
      Promise.resolve(id === terminal.id ? terminal : mate)
    );
    getSchedule.mockResolvedValue({
      schedule: {
        date: getCurrentServiceDate(),
        mateId: mate.id,
        slots: [],
        terminalId: terminal.id,
      },
      timestamp: 0,
    });
    const controller: NavigationController = { navigate: () => undefined };
    const container = await renderNavigableRoute(
      controller,
      "/terminal-a/terminal-b/fare"
    );
    expect(container.textContent).toContain("Fares A");

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b/cameras");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const motion = [...container.querySelectorAll(".route-tab-motion")].find(
      (element) => element.textContent?.includes("Cameras A")
    );
    expect(motion?.classList).toContain("route-tab-motion--to-left");
    expect(motion?.textContent).toContain("Cameras A");
  });

  // retain accepted terminal facts across tabs without crossing route pairs
  it("propagates alert refresh facts across tabs and ignores stale pair results", async () => {
    const terminalA = {
      bulletins: [{ title: "Old wait alert" }],
      id: "terminal-a",
      mates: [{ id: "terminal-b" }, { id: "terminal-x" }],
      name: "A",
      routes: {},
      waitTimes: [{ description: "Old wait", time: 1 }],
    };
    const mateB = {
      id: "terminal-b",
      mates: [{ id: "terminal-a" }],
      name: "B",
      routes: {},
    };
    const terminalC = {
      bulletins: [{ title: "Current C alert" }],
      id: "terminal-c",
      mates: [{ id: "terminal-d" }, { id: "terminal-y" }],
      name: "C",
      routes: {},
      waitTimes: [{ description: "Current C wait", time: 2 }],
    };
    const mateD = {
      id: "terminal-d",
      mates: [{ id: "terminal-c" }],
      name: "D",
      routes: {},
    };
    const terminals = new Map(
      [terminalA, mateB, terminalC, mateD].map((terminal) => [
        terminal.id,
        terminal,
      ])
    );
    getTerminal.mockImplementation((id: string) =>
      Promise.resolve(terminals.get(id))
    );
    getSchedule.mockImplementation(
      (terminal: { id: string }, mate: { id: string }) =>
        Promise.resolve({
          schedule: {
            date: getCurrentServiceDate(),
            mateId: mate.id,
            slots: [],
            terminalId: terminal.id,
          },
          timestamp: 0,
        })
    );
    const controller: NavigationController = { navigate: () => undefined };
    const container = await renderNavigableRoute(controller);

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b/alerts");
      await Promise.resolve();
      await Promise.resolve();
    });
    const firstPairRefresh = bulletinRefresh.onTerminalRefresh;
    expect(firstPairRefresh).toBeTypeOf("function");

    await act(async () => {
      firstPairRefresh?.({
        ...terminalA,
        bulletins: [],
        waitTimes: [{ description: "Fresh wait", time: 3 }],
      });
      await Promise.resolve();
    });
    expect(bulletinRefresh.onTerminalRefresh).toBe(firstPairRefresh);

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b");
      await Promise.resolve();
      await Promise.resolve();
    });
    let scheduleView = container.querySelector("[data-departure-wait]");
    expect(scheduleView?.getAttribute("data-departure-wait")).toBe(
      "Fresh wait"
    );
    expect(scheduleView?.getAttribute("data-departure-bulletin-count")).toBe(
      "0"
    );

    await act(async () => {
      controller.navigate("/terminal-c/terminal-d/alerts");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Alerts C");

    await act(async () => {
      firstPairRefresh?.({
        ...terminalA,
        bulletins: [],
        waitTimes: [{ description: "Stale A wait", time: 4 }],
      });
      controller.navigate("/terminal-c/terminal-d");
      await Promise.resolve();
      await Promise.resolve();
    });
    scheduleView = container.querySelector("[data-departure-wait]");
    expect(scheduleView?.getAttribute("data-departure-wait")).toBe(
      "Current C wait"
    );
    expect(scheduleView?.getAttribute("data-departure-bulletin-count")).toBe(
      "1"
    );
  });

  it("updates the schedule once per tab navigation without entering a render loop", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [
        { id: "terminal-b", name: "B" },
        { id: "terminal-c", name: "C" },
      ],
      name: "A",
      routes: {},
    };
    const mate = {
      id: "terminal-b",
      mates: [{ id: "terminal-a", name: "A" }],
      name: "B",
      routes: {},
    };
    getTerminal.mockImplementation((id: string) =>
      Promise.resolve(id === terminal.id ? terminal : mate)
    );
    getSchedule.mockResolvedValue({
      schedule: {
        date: getCurrentServiceDate(),
        mateId: mate.id,
        slots: [],
        terminalId: terminal.id,
      },
      timestamp: 0,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const controller: NavigationController = {
      navigate: () => undefined,
    };
    const container = await renderNavigableRoute(controller);

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b/map");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Map A");

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Schedule terminal-a");
    expect(getSchedule).toHaveBeenCalledTimes(3);
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Maximum update depth exceeded")
      )
    ).toBe(false);
    consoleError.mockRestore();
  });

  // map sailing navigation
  it("preserves sailing detail params when navigating from map to schedule", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [
        { id: "terminal-b", name: "B" },
        { id: "terminal-c", name: "C" },
      ],
      name: "A",
      routes: {},
    };
    const mate = {
      id: "terminal-b",
      mates: [{ id: "terminal-a", name: "A" }],
      name: "B",
      routes: {},
    };
    getTerminal.mockImplementation((id: string) =>
      Promise.resolve(id === terminal.id ? terminal : mate)
    );
    getSchedule.mockImplementation(
      (_terminal, _mate, requestedDate: DateTime) =>
        Promise.resolve({
          schedule: {
            date: requestedDate.toISODate(),
            mateId: mate.id,
            slots: [],
            terminalId: terminal.id,
          },
          timestamp: 0,
        })
    );
    const controller: NavigationController = {
      navigate: () => undefined,
    };
    const container = await renderNavigableRoute(controller);

    await act(async () => {
      controller.navigate("/terminal-a/terminal-b/map?vessel=1");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const date = DateTime.local().plus({ days: 1 }).toISODate();
    await act(async () => {
      controller.navigate(
        `/terminal-a/terminal-b?date=${date}&sailing=1788300000&tab=vessel`
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.currentPath).toBe(
      `/terminal-a/terminal-b?date=${date}&sailing=1788300000&tab=vessel`
    );
    expect(container.textContent).toContain("Schedule terminal-a");
  });

  // query identity retry
  it("retries route loading when a deep-link query changes in flight", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [
        { id: "terminal-b", name: "B" },
        { id: "terminal-c", name: "C" },
      ],
      name: "A",
      routes: {},
    };
    const mate = {
      id: "terminal-b",
      mates: [{ id: "terminal-a", name: "A" }],
      name: "B",
      routes: {},
    };
    const staleTerminal = deferred<typeof terminal>();
    getTerminal
      .mockReturnValueOnce(staleTerminal.promise)
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(mate);
    getSchedule.mockResolvedValue({
      schedule: {
        date: getCurrentServiceDate(),
        mateId: mate.id,
        slots: [],
        terminalId: terminal.id,
      },
      timestamp: 0,
    });
    const controller: NavigationController = {
      navigate: () => undefined,
    };
    const sailingQuery = "sailing=1788327000&tab=vessel";
    const container = await renderNavigableRoute(
      controller,
      `/terminal-a/terminal-b?date=${getCurrentServiceDate()}&${sailingQuery}`
    );

    await act(async () => {
      controller.navigate(`/terminal-a/terminal-b?${sailingQuery}`);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getTerminal).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Schedule terminal-a");
    expect(controller.currentPath).toBe(
      `/terminal-a/terminal-b?${sailingQuery}`
    );
  });

  it("synchronously hides prior schedule on normalized date-query navigation", async () => {
    const terminal = {
      id: "terminal-a",
      mates: [{ id: "terminal-b" }, { id: "terminal-c" }],
      name: "A",
      routes: {},
    };
    const mate = { id: "terminal-b", mates: [], name: "B", routes: {} };
    getTerminal.mockResolvedValueOnce(terminal).mockResolvedValueOnce(mate);
    getSchedule.mockResolvedValue({
      schedule: {
        date: getCurrentServiceDate(),
        mateId: mate.id,
        slots: [],
        terminalId: terminal.id,
      },
      timestamp: 0,
    });
    const controller: NavigationController = {
      navigate: () => undefined,
    };
    const container = await renderNavigableRoute(controller);
    expect(container.textContent).toContain("Schedule terminal-a");

    const nextTerminal = deferred<typeof terminal>();
    getTerminal.mockReturnValue(nextTerminal.promise);
    act(() => {
      controller.navigate("/terminal-a/terminal-b?date=2026-08-14");
    });

    expect(container.textContent).not.toContain("Loading route");
    expect(container.textContent).toContain("Empty schedule");
    expect(container.textContent).not.toContain("Schedule terminal-a");
    expect(getTerminal).toHaveBeenCalledTimes(2);
  });
});
