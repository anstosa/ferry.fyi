// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    isRefreshing,
    onClick,
    sourceUpdatedAt,
  }: {
    isRefreshing?: boolean;
    onClick: () => void;
    sourceUpdatedAt: number;
  }) =>
    React.createElement(
      "button",
      {
        "aria-busy": Boolean(isRefreshing),
        "aria-label": "refresh bulletins",
        "data-source-updated-at": sourceUpdatedAt,
        disabled: Boolean(isRefreshing),
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

// render the alert owner with optional clock and refresh-observer boundaries
const view = (
  routeTerminal: Terminal,
  path = "/clinton/alerts",
  routeSnapshot: PublicSsrSnapshot | null = snapshot,
  options: {
    onTerminalRefresh?: (terminal: Terminal) => void;
    time?: DateTime;
  } = {}
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
        onTerminalRefresh: options.onTerminalRefresh,
        setRoute: () => undefined,
        terminal: routeTerminal,
        time:
          options.time ??
          DateTime.fromISO("2026-07-29T12:00:00", {
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
  controller: NavigationController,
  onTerminalRefresh?: (terminal: Terminal) => void
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
      onTerminalRefresh,
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
    vi.restoreAllMocks();
  });

  // use the active ferry day for current schedule and fare links across midnight
  it.each(["00:15", "02:59", "03:00"])(
    "keeps current planning links undated at %s Pacific",
    async (hour) => {
      const time = DateTime.fromISO(`2026-07-29T${hour}:00`, {
        zone: "America/Los_Angeles",
      });
      vi.spyOn(Date, "now").mockReturnValue(time.toMillis());
      mocks.refreshBulletins.mockReturnValue(new Promise(() => undefined));
      const container = document.createElement("div");
      root = createRoot(container);
      await act(() => {
        root?.render(view(terminal([]), "/clinton/alerts", null, { time }));
      });
      const links = [
        ...container.querySelectorAll<HTMLAnchorElement>(
          'nav[aria-label="Alert planning links"] a'
        ),
      ];
      expect(
        links
          .find((link) => link.textContent === "Schedule & wait")
          ?.getAttribute("href")
      ).toBe("/clinton");
      expect(
        links
          .find((link) => link.textContent === "How much does it cost?")
          ?.getAttribute("href")
      ).toBe("/clinton/fare");
    }
  );

  // notify the retained route only after accepting automatic and manual results
  it("publishes accepted refresh results to the route owner", async () => {
    const initial = terminal([fresh]);
    const manual = terminal([]);
    mocks.refreshBulletins
      .mockResolvedValueOnce({ sourceUpdatedAt: 2, terminal: initial })
      .mockResolvedValueOnce({ sourceUpdatedAt: 3, terminal: manual });
    const onTerminalRefresh = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(() => {
      root?.render(
        view(terminal([stale]), "/clinton/alerts", snapshot, {
          onTerminalRefresh,
        })
      );
    });
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(initial);
    await act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="refresh bulletins"]')
        ?.click();
    });
    expect(onTerminalRefresh).toHaveBeenCalledTimes(2);
    expect(onTerminalRefresh).toHaveBeenLastCalledWith(manual);
  });

  // keep a newer manual result when its older automatic request finishes later
  it("keeps the latest manual refresh after an older automatic success", async () => {
    let resolveAutomatic:
      | ((result: {
          sourceUpdatedAt: number | null;
          terminal: Terminal;
        }) => void)
      | undefined;
    const manual = terminal([fresh]);
    mocks.refreshBulletins
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAutomatic = resolve;
          })
      )
      .mockResolvedValueOnce({ sourceUpdatedAt: 3, terminal: manual });
    const onTerminalRefresh = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        view(terminal([stale]), "/clinton/alerts", snapshot, {
          onTerminalRefresh,
        })
      );
      await Promise.resolve();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="refresh bulletins"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain(stale.title);
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(manual);
    expect(
      container
        .querySelector('[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("3");

    await act(async () => {
      resolveAutomatic?.({ sourceUpdatedAt: 2, terminal: terminal([]) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain("All clear");
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(manual);
    expect(
      container
        .querySelector('[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe("3");
  });

  // ignore an older automatic failure after a newer manual result settles
  it("keeps the latest manual refresh after an older automatic failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let rejectAutomatic: ((error: Error) => void) | undefined;
    const manual = terminal([fresh]);
    mocks.refreshBulletins
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectAutomatic = reject;
          })
      )
      .mockResolvedValueOnce({ sourceUpdatedAt: 3, terminal: manual });
    const onTerminalRefresh = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        view(terminal([stale]), "/clinton/alerts", snapshot, {
          onTerminalRefresh,
        })
      );
      await Promise.resolve();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="refresh bulletins"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const freshness = container.querySelector<HTMLButtonElement>(
      '[aria-label="refresh bulletins"]'
    );
    expect(freshness?.getAttribute("aria-busy")).toBe("false");
    expect(freshness?.disabled).toBe(false);
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(manual);

    await act(async () => {
      rejectAutomatic?.(new Error("older offline response"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain("Service alerts unavailable");
    expect(container.textContent).not.toContain("Could not refresh alerts");
    expect(freshness?.getAttribute("aria-busy")).toBe("false");
    expect(freshness?.disabled).toBe(false);
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(manual);
    consoleError.mockRestore();
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
    await act(() => root?.render(view(terminal([]), "/clinton/alerts", null)));
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(false);
    expect(useful.ref).toHaveBeenCalledWith(container.querySelector("section"));
    expect(container.textContent).toContain(
      "Checking current WSF service alerts"
    );
    expect(container.textContent).not.toContain("All clear");
    expect(
      container.querySelector('[aria-label="Loading route alerts"]')
    ).not.toBeNull();
    await act(() => resolve?.({ sourceUpdatedAt: 1, terminal: terminal([]) }));
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);
    expect(container.textContent).toContain("All clear");
    expect(
      container.querySelector('[aria-label="Loading route alerts"]')
    ).toBeNull();
  });

  // a failed source check remains unknown and offers a retry
  it("does not claim an all-clear when initial alerts are unavailable", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.refreshBulletins.mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([]), "/clinton/alerts", null));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Service alerts unavailable");
    expect(container.textContent).toContain("could not confirm");
    expect(container.textContent).not.toContain("All clear");
    const retry = container.querySelector<HTMLButtonElement>(
      "button.button-primary"
    );
    expect(retry?.textContent).toBe("Try again");

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Could not refresh alerts. Current WSF alert status is unavailable."
    );
    expect(container.textContent).not.toContain("Showing saved data");
    consoleError.mockRestore();
  });

  // an explicit unavailable snapshot is not an empty alert result
  it("preserves an authoritative unavailable outcome while live data is pending", async () => {
    mocks.refreshBulletins.mockReturnValue(new Promise(() => undefined));
    const unavailableSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        bulletins: {
          observedAt: "2026-07-29T12:00:00.000Z",
          outcome: "authoritatively-unavailable",
          reason: "source-unavailable",
          sourceUpdatedAt: null,
        },
      },
    } as PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([]), "/clinton/alerts", unavailableSnapshot));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Service alerts unavailable");
    expect(container.textContent).not.toContain("All clear");
    expect(
      container.querySelector('button[aria-label="refresh bulletins"]')
    ).toBeNull();
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(false);
  });

  // show the alert itself without a redundant link back to the alerts page
  it("omits the terminal alerts button from bulletin rows", async () => {
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
    expect(container.querySelector("li article a")).toBeNull();
    expect(container.querySelector("li article h3")?.textContent).toBe(
      fresh.title
    );
    expect(container.querySelector("li article p")?.textContent).toBe(
      fresh.bodyText
    );
    expect(container.querySelector("li article time")).not.toBeNull();
    expect(container.textContent).not.toContain("View terminal alerts");
    expect(container.textContent).not.toContain("View WSF alert");
  });

  // use unboxed semantic rows while retaining severity and source time
  it("renders compact alert rows without top-level card wrappers", async () => {
    mocks.refreshBulletins.mockResolvedValue({
      sourceUpdatedAt: 2,
      terminal: terminal([{ ...fresh, level: Level.HIGH }]),
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = container.querySelector("li");
    expect(row?.classList).toContain("border-b");
    expect(row?.className).not.toMatch(/rounded-2xl|shadow-sm|bg-white/);
    expect(row?.querySelector("h3")?.textContent).toBe(fresh.title);
    expect(row?.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
    expect(row?.querySelector("article > p")?.classList).toContain(
      "break-words"
    );
    expect(row?.textContent).toContain("High impact");
    const planningLinks = container.querySelector(
      'nav[aria-label="Alert planning links"]'
    );
    const setupLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/clinton/subscribe"]'
    );
    expect(planningLinks?.querySelectorAll("a")).toHaveLength(6);
    expect(setupLink?.classList).toContain("button-primary");
    expect(planningLinks?.compareDocumentPosition(setupLink as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  // calculate visible counts after filtering upstream promotions
  it("excludes opinion-group promotions from refreshed alert rows and counts", async () => {
    mocks.refreshBulletins.mockResolvedValue({
      sourceUpdatedAt: 2,
      terminal: terminal([
        bulletin("Join the Ferry Riders Opinion Group"),
        fresh,
      ]),
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(view(terminal([])));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll("li article")).toHaveLength(1);
    expect(container.textContent).toContain("1 active alert from WSF");
    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain("Ferry Riders Opinion Group");
  });

  // keep source age docked independently of alert content height
  it("docks freshness above the footer without extending the alert scroll area", async () => {
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
    const freshness = container.querySelector<HTMLElement>(
      '[data-live-freshness="bulletins"]'
    );
    expect(freshness?.classList).toContain("fixed");
    expect(freshness?.classList).toContain("inset-x-0");
    expect(freshness?.classList).toContain("justify-center");
    expect(freshness?.classList).toContain("pointer-events-none");
    expect(freshness?.style.bottom).toBe(
      "calc(var(--route-footer-height) + var(--safe-area-inset-bottom) + 0.25rem)"
    );
    expect(container.querySelector("main")?.contains(freshness)).toBe(false);
    expect(
      freshness?.querySelector('button[aria-label="refresh bulletins"]')
    ).not.toBeNull();
  });

  // atomically replace saved alerts and their source timestamp
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
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
    expect(container.textContent).toContain(
      "1 saved alert; checking for updates"
    );
    expect(container.textContent).not.toContain("active alert from WSF");
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
    expect(container.textContent).toContain(
      "1 saved alert; current status unavailable"
    );
    expect(container.textContent).not.toContain("All clear");
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);
    consoleError.mockRestore();
  });

  // a stale empty list remains unknown until the live source settles
  it("never turns a stale empty seed into a current all-clear", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let rejectRefresh: (error: Error) => void = () => undefined;
    mocks.refreshBulletins.mockReturnValue(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      })
    );
    const emptyStaleSnapshot = {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        bulletins: {
          ...snapshot.sources.bulletins,
          value: [],
        },
      },
    } as PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        view(terminal([fresh]), "/clinton/alerts", emptyStaleSnapshot)
      );
      await Promise.resolve();
    });

    const expectedTimestamp = Date.parse("2026-07-29T11:00:00.000Z") / 1000;
    expect(container.textContent).toContain(
      "Checking current WSF service alerts"
    );
    expect(container.textContent).not.toContain("All clear");
    expect(
      container.querySelector('[aria-label="Loading route alerts"]')
    ).not.toBeNull();
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe(String(expectedTimestamp));
    expect(useful.hook.mock.calls.at(-1)?.[2]).toBe(true);

    await act(async () => {
      rejectRefresh(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Service alerts unavailable");
    expect(container.textContent).not.toContain("All clear");
    expect(
      container.querySelector('[aria-label="Loading route alerts"]')
    ).toBeNull();
    expect(
      container
        .querySelector('button[aria-label="refresh bulletins"]')
        ?.getAttribute("data-source-updated-at")
    ).toBe(String(expectedTimestamp));
    consoleError.mockRestore();
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
    const onTerminalRefresh = vi.fn();

    await act(async () => {
      root?.render(navigableView(terminal([]), controller, onTerminalRefresh));
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
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(
      terminal([fresh], { id: "1", name: "Anacortes" })
    );

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
    expect(onTerminalRefresh).toHaveBeenCalledTimes(1);
  });

  // reject a manual result after its route is no longer active
  it("does not publish a pending manual refresh after changing routes", async () => {
    let resolveManual:
      | ((result: {
          sourceUpdatedAt: number | null;
          terminal: Terminal;
        }) => void)
      | undefined;
    const initialLive = terminal([fresh]);
    const nextLive = terminal([fresh], { id: "1", name: "Anacortes" });
    mocks.refreshBulletins
      .mockResolvedValueOnce({ sourceUpdatedAt: 2, terminal: initialLive })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManual = resolve;
          })
      )
      .mockResolvedValue({ sourceUpdatedAt: 3, terminal: nextLive });
    const onTerminalRefresh = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: NavigationController = { navigate: () => undefined };

    await act(async () => {
      root?.render(navigableView(terminal([]), controller, onTerminalRefresh));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onTerminalRefresh).toHaveBeenCalledExactlyOnceWith(initialLive);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="refresh bulletins"]')
        ?.click();
      await Promise.resolve();
    });
    expect(mocks.refreshBulletins).toHaveBeenCalledTimes(2);

    await act(async () => {
      controller.navigate("/anacortes/alerts", nextLive);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onTerminalRefresh).toHaveBeenCalledTimes(2);
    expect(onTerminalRefresh).toHaveBeenLastCalledWith(nextLive);

    await act(async () => {
      resolveManual?.({
        sourceUpdatedAt: 4,
        terminal: terminal([bulletin("Late manual Clinton alert")]),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onTerminalRefresh).toHaveBeenCalledTimes(2);
    expect(onTerminalRefresh).toHaveBeenLastCalledWith(nextLive);
    expect(container.textContent).toContain(fresh.title);
    expect(container.textContent).not.toContain("Late manual Clinton alert");
  });
});
