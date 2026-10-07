// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";

const useful = vi.hoisted(() => ({ hook: vi.fn(), ref: vi.fn() }));
const headerShare = vi.hoisted(() => vi.fn());
vi.mock("~/lib/usefulVisits", () => ({
  // capture only the production readiness and target boundary
  useUsefulContent: (...args: unknown[]) => {
    useful.hook(...args);
    return useful.ref;
  },
}));
const mocks = vi.hoisted(() => ({
  refreshBulletins: vi.fn(),
}));

vi.mock("~/lib/terminals", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../client/lib/terminals")>();
  return {
    ...original,
    refreshBulletins: mocks.refreshBulletins,
    useTerminals: () => ({ closestTerminal: null, terminals: [] }),
  };
});
vi.mock("~/components/FreshnessPill", () => ({
  FreshnessPill: ({
    onClick,
    sourceUpdatedAt,
  }: {
    onClick: () => void;
    sourceUpdatedAt: number;
  }) =>
    React.createElement(
      "button",
      {
        "aria-label": "refresh bulletins",
        "data-source-updated-at": sourceUpdatedAt,
        onClick,
        type: "button",
      },
      String(sourceUpdatedAt)
    ),
}));
vi.mock("~/components/HeaderDropdown", () => ({
  HeaderDropdown: () => null,
}));
vi.mock("~/components/NotificationPermissionWarning", () => ({
  NotificationPermissionWarning: () => null,
}));
vi.mock("~/static/images/icons/regular/bell.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/bell.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/bell-exclamation.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/exclamation-triangle.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/info-circle.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/wsdot.svg", () => ({
  default: () => null,
}));
vi.mock("../../client/views/Header", () => ({
  // inspect the actual public sharing payload from the rendered owner
  Header: ({
    children,
    share,
  }: React.PropsWithChildren<{ share?: ShareOptions }>) => {
    headerShare(share);
    return React.createElement("header", null, children);
  },
}));

import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { Bulletins } from "../../client/views/Bulletins";
import { type Bulletin, Level } from "../../shared/contracts/bulletins";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";
import type { Terminal } from "../../shared/contracts/terminals";

const bulletin = (title: string): Bulletin => ({
  bodyHTML: `<p>${title}</p>`,
  bodyText: title,
  date: 1_700_000_000,
  level: Level.INFO,
  routePrefix: "All",
  terminalId: "5",
  title,
});

const terminal = (
  bulletins: Bulletin[],
  { id = "5", name = "Clinton" }: { id?: string; name?: string } = {}
): Terminal =>
  ({
    bulletins,
    id,
    mates: [],
    name,
    routes: {},
    terminalUrl: null,
  }) as Terminal;

const stale = bulletin("Stale seeded alert");
const fresh = bulletin("Fresh terminal alert");
const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/clinton/alerts",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/clinton/alerts",
    description: "Alerts",
    robots: "index,follow",
    title: "Alerts",
  },
  normalizedUrl: { path: "/clinton/alerts", query: {} },
  renderedAt: "2026-07-29T12:00:00.000Z",
  routeId: "terminal-alerts",
  routeParams: { terminalSlug: "clinton" },
  sources: {
    bulletins: {
      observedAt: "2026-07-29T12:00:00.000Z",
      outcome: "stale-usable",
      sourceUpdatedAt: "2026-07-29T11:00:00.000Z",
      value: [stale],
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as PublicSsrSnapshot;

const view = (
  routeTerminal: Terminal,
  path = "/clinton/alerts",
  routeSnapshot: PublicSsrSnapshot | null = snapshot
) =>
  React.createElement(
    PublicSsrSeedProvider,
    { snapshot: routeSnapshot ?? undefined },
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Bulletins, {
        getPath: () => "/clinton/subscribe",
        mate: null,
        setRoute: () => undefined,
        terminal: routeTerminal,
        time: DateTime.fromISO("2026-07-29T12:00:00", {
          zone: "America/Los_Angeles",
        }),
      })
    )
  );

interface NavigationController {
  navigate: (path: string, routeTerminal: Terminal) => void;
}

const navigableView = (
  initialTerminal: Terminal,
  controller: NavigationController
) => {
  const Harness = () => {
    const navigate = useNavigate();
    const [routeTerminal, setRouteTerminal] = React.useState(initialTerminal);
    controller.navigate = (path, nextTerminal) => {
      setRouteTerminal(nextTerminal);
      navigate(path);
    };
    return React.createElement(Bulletins, {
      getPath: () => "/clinton/subscribe",
      mate: null,
      setRoute: () => undefined,
      terminal: routeTerminal,
      time: DateTime.fromISO("2026-07-29T12:00:00", {
        zone: "America/Los_Angeles",
      }),
    });
  };

  return React.createElement(
    PublicSsrSeedProvider,
    { snapshot },
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/clinton/alerts"] },
      React.createElement(Harness)
    )
  );
};

describe("bulletin hydration seed", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  // an unconfirmed default empty array is not useful all-clear content
  it("waits for successful live settlement when an empty page has no matching seed", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    mocks.refreshBulletins.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(view(terminal([]), "/clinton/alerts", null))
    );
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(false);
    expect(useful.ref).toHaveBeenCalledWith(container.querySelector("section"));
    await act(async () =>
      resolve?.({ sourceUpdatedAt: 1, terminal: terminal([]) })
    );
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);
  });

  // label a notification landing page without claiming an upstream source
  it("labels canonical bulletin landing links as terminal alerts", async () => {
    const linked = { ...fresh, url: "https://ferry.fyi/clinton/alerts" };
    mocks.refreshBulletins.mockResolvedValue({
      sourceUpdatedAt: 2,
      terminal: terminal([linked]),
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
    });
    expect(
      container.querySelector(`a[href="${linked.url}"]`)?.textContent
    ).toBe("View terminal alerts");
    expect(container.textContent).not.toContain("View WSF alert");
  });

  // replace the live result while retaining its classified sharing payload
  it("atomically replaces seeded alerts and freshness after a successful refresh", async () => {
    mocks.refreshBulletins.mockResolvedValue({
      sourceUpdatedAt: 2,
      terminal: terminal([fresh]),
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(headerShare).toHaveBeenLastCalledWith({
      shareSurface: "bulletins",
      shareButtonText: "Share Alerts",
      sharedText: "Alerts for Clinton",
    });
    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("2");
  });

  it("keeps the matching snapshot result while live refresh is pending or rejected", async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    mocks.refreshBulletins.mockReturnValue(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
    });

    const expectedTimestamp = Date.parse("2026-07-29T11:00:00.000Z") / 1000;
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe(String(expectedTimestamp));
    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);

    await act(async () => {
      rejectRefresh(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe(String(expectedTimestamp));
    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);
  });

  it("does not attach newer freshness to older no-seed cached content", async () => {
    let resolveRefresh:
      | ((result: {
          sourceUpdatedAt: number | null;
          terminal: Terminal;
        }) => void)
      | undefined;
    mocks.refreshBulletins.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([stale]), "/clinton/alerts", null));
      await Promise.resolve();
    });

    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(false);
    expect(
      container.querySelector('button[aria-label="refresh bulletins"]')
    ).toBeNull();

    await act(async () => {
      resolveRefresh?.({
        sourceUpdatedAt: 2_000_000_000,
        terminal: terminal([fresh]),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("2000000000");
  });

  it("honors a matching explicit empty bulletin outcome", async () => {
    mocks.refreshBulletins.mockReturnValue(new Promise(() => undefined));
    const emptySnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        bulletins: {
          ...snapshot.sources.bulletins,
          outcome: "empty",
          value: [],
        },
      },
    } as PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([fresh]), "/clinton/alerts", emptySnapshot));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("All clear");
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);
    expect(container.textContent).not.toContain(fresh.title);
  });

  it("stops overlaying the seed when the terminal prop is replaced", async () => {
    mocks.refreshBulletins.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const initialTerminal = terminal([]);

    await act(async () => {
      root?.render(view(initialTerminal));
      await Promise.resolve();
    });
    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);

    act(() => {
      root?.render(view(terminal([fresh])));
    });
    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
  });

  it("does not reuse a previous route seed after unmount and remount", async () => {
    mocks.refreshBulletins.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
    });
    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);

    act(() => root?.unmount());
    root = createRoot(container);
    await act(async () => {
      root?.render(
        view(
          terminal([fresh], { id: "1", name: "Anacortes" }),
          "/anacortes/alerts"
        )
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
  });

  it("ignores a successful refresh response from the previous route", async () => {
    let resolvePrevious:
      | ((result: {
          sourceUpdatedAt: number | null;
          terminal: Terminal;
        }) => void)
      | undefined;
    mocks.refreshBulletins.mockImplementation((terminalId: string) => {
      if (terminalId === "5") {
        return new Promise((resolve) => {
          resolvePrevious = resolve;
        });
      }
      return Promise.resolve({
        sourceUpdatedAt: 3,
        terminal: terminal([fresh], { id: "1", name: "Anacortes" }),
      });
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: NavigationController = {
      navigate: () => undefined,
    };

    await act(async () => {
      root?.render(navigableView(terminal([]), controller));
      await Promise.resolve();
    });
    expect(container.textContent).toContain(stale.title);
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);

    await act(async () => {
      controller.navigate(
        "/anacortes/alerts",
        terminal([fresh], { id: "1", name: "Anacortes" })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("3");

    await act(async () => {
      resolvePrevious?.({
        sourceUpdatedAt: 4,
        terminal: terminal([bulletin("Late Clinton alert")]),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
    expect(container.textContent).not.toContain("Late Clinton alert");
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("3");
  });
});
