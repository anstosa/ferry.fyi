// @vitest-environment jsdom

import { DateTime } from "luxon";
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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const getTerminal = vi.hoisted(() => vi.fn());
const getSchedule = vi.hoisted(() => vi.fn());
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  getTerminal,
}));
vi.mock("~/lib/schedule", () => ({
  getSchedule,
  refreshSchedule: vi.fn(),
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
vi.mock("~/components/DateButton", () => ({ DateButton: () => null }));
vi.mock("~/components/RouteSelector", () => ({ RouteSelector: () => null }));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/views/Header", () => ({
  Header: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../client/views/Schedule", () => ({
  Schedule: ({
    schedule,
  }: {
    schedule: { date: string; terminalId: string } | null;
  }) =>
    React.createElement(
      "p",
      undefined,
      schedule
        ? `Schedule ${schedule.terminalId} ${schedule.date}`
        : "Empty schedule"
    ),
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
vi.mock("../../client/views/Bulletins", () => ({
  Bulletins: ({ terminal }: { terminal: { name: string } | null }) =>
    React.createElement("p", undefined, `Alerts ${terminal?.name ?? "empty"}`),
}));

import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { Route } from "../../client/views/Route";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
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

function getLocalScheduleDate(): string {
  return DateTime.local().toFormat("yyyy-MM-dd");
}

const getView = (pathname: string): "alerts" | "map" | "schedule" => {
  if (pathname.endsWith("/map")) {
    return "map";
  }
  if (pathname.endsWith("/alerts")) {
    return "alerts";
  }
  return "schedule";
};

interface NavigationController {
  navigate: (path: string) => void;
}

const renderNavigableRoute = async (controller: NavigationController) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Harness = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    controller.navigate = navigate;
    return React.createElement(Route, { view: getView(pathname) });
  };
  await act(async () => {
    root?.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/terminal-a/terminal-b"] },
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

const renderSeededMapRoute = async (seededVessels: unknown[]) => {
  const date = getLocalScheduleDate();
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
  const snapshot = {
    canonicalHost: "ferry.fyi",
    canonicalPath: "/terminal-a/terminal-b/map",
    hostProfile: "ferry.fyi",
    indexability: "indexable",
    metadata: {
      canonicalPath: "/terminal-a/terminal-b/map",
      description: "Map",
      robots: "index,follow",
      title: "Map",
    },
    normalizedUrl: {
      path: "/terminal-a/terminal-b/map",
      query: {},
    },
    renderedAt: "2026-07-30T12:00:00.000Z",
    routeId: "mate-map",
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
          terminalId: terminal.id,
        },
        timestamp: 0,
      }),
      vessels: source(seededVessels),
    },
    version: PUBLIC_SSR_SNAPSHOT_VERSION,
  } as PublicSsrSnapshot;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      React.createElement(
        PublicSsrSeedProvider,
        { snapshot },
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/terminal-a/terminal-b/map"] },
          React.createElement(
            Routes,
            undefined,
            React.createElement(RouterRoute, {
              path: "/:terminalSlug/:mateSlug/map",
              element: React.createElement(Route, { view: "map" }),
            })
          )
        )
      )
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, date };
};

describe("Route route-load errors", () => {
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
    "synchronously hides prior route content on same-tree navigation to %s",
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
          date: getLocalScheduleDate(),
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
      getTerminal.mockReturnValueOnce(nextTerminal.promise);
      act(() => {
        controller.navigate(`/terminal-a/terminal-b/${view}`);
      });

      expect(container.textContent).toContain("Loading route");
      expect(container.textContent).not.toContain("Schedule terminal-a");
      expect(container.textContent).not.toContain("Map A");
      expect(container.textContent).not.toContain("Alerts A");
    }
  );

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
        date: getLocalScheduleDate(),
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
        date: getLocalScheduleDate(),
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
    getTerminal.mockReturnValueOnce(nextTerminal.promise);
    act(() => {
      controller.navigate("/terminal-a/terminal-b?date=2026-08-14");
    });

    expect(container.textContent).toContain("Loading route");
    expect(container.textContent).not.toContain("Schedule terminal-a");
  });
});
