// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deferMapLoad: false,
  maps: [] as Array<{
    removed: boolean;
    triggerLoad: () => void;
  }>,
  getVesselSnapshot: vi.fn(),
  refreshVessels: vi.fn(),
  theme: "light",
}));

vi.mock("mapbox-gl", () => {
  class Bounds {}
  class Mapbox {
    container: HTMLElement;
    loadCallbacks: Array<() => void> = [];
    points = new globalThis.Map<string, { x: number; y: number }>();
    removed = false;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
      mocks.maps.push(this);
      this.container.getBoundingClientRect = () =>
        ({
          bottom: 800,
          height: 800,
          left: 0,
          right: 1200,
          top: 0,
          width: 1200,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        }) as DOMRect;
    }

    addControl = vi.fn();
    fitBounds = vi.fn();
    getContainer = () => {
      if (this.removed) {
        throw new Error("Map has been removed");
      }
      return this.container;
    };
    off = vi.fn();
    on = vi.fn((event: string, callback: () => void) => {
      if (event === "load") {
        this.loadCallbacks.push(callback);
        if (!mocks.deferMapLoad) {
          callback();
        }
      }
    });

    project = ([longitude, latitude]: [number, number]) => {
      const key = `${longitude}:${latitude}`;
      const point = this.points.get(key) ?? {
        x: 100 + this.points.size * 300,
        y: 200,
      };
      this.points.set(key, point);
      return point;
    };

    remove = vi.fn(() => {
      this.removed = true;
    });
    triggerLoad = () => this.loadCallbacks.forEach((callback) => callback());
  }
  class Marker {
    element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
    }

    addTo = (map: Mapbox) => {
      map.getContainer().append(this.element);
      return this;
    };

    remove = vi.fn(() => this.element.remove());
    setLngLat = () => this;
  }
  return {
    LngLatBounds: Bounds,
    Map: Mapbox,
    Marker,
    NavigationControl: class {},
  };
});
vi.mock("~/lib/vessels", () => ({
  getVesselSnapshot: mocks.getVesselSnapshot,
  refreshVessels: mocks.refreshVessels,
}));
vi.mock("~/lib/geo", () => ({
  useGeo: () => [null],
}));
vi.mock("~/lib/terminals", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../client/lib/terminals")>();
  return {
    ...original,
    useTerminalList: () => [],
  };
});
vi.mock("~/lib/theme", () => ({
  useResolvedTheme: () => mocks.theme,
}));
vi.mock("~/lib/window", () => ({
  useWindowSize: () => ({ height: 800, width: 1200 }),
}));
vi.mock("~/components/FreshnessPill", () => ({
  FreshnessPill: ({ sourceUpdatedAt }: { sourceUpdatedAt: number }) =>
    React.createElement("output", {
      "aria-label": "vessel freshness",
      "data-source-updated-at": sourceUpdatedAt,
    }),
}));
vi.mock("~/components/ReloadButton", () => ({
  ReloadButton: () => null,
}));
vi.mock("~/static/images/icons/solid/caret-down.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/caret-up.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/location.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/location-arrow.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/map-marker.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/wsdot.svg", () => ({
  default: () => null,
}));
vi.mock("../../client/views/Header", () => ({
  Header: ({ children }: React.PropsWithChildren) =>
    React.createElement("header", null, children),
}));

import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import {
  getVesselAssignmentSet,
  selectVisibleVesselContent,
} from "../../client/lib/vesselAssignments";
import { Map } from "../../client/views/Map";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";
import type { Terminal } from "../../shared/contracts/terminals";
import type { Vessel } from "../../shared/contracts/vessels";

const terminal = {
  id: "5",
  location: { latitude: 47.98, longitude: -122.35 },
  mates: [
    {
      id: "14",
      location: { latitude: 47.95, longitude: -122.3 },
      name: "Mukilteo",
    },
  ],
  name: "Clinton",
  routes: {
    route: {
      abbreviation: "CLI-MUK",
      description: "Clinton / Mukilteo",
      id: "route",
      terminalIds: ["5", "14"],
    },
  },
  vesselWatchUrl: null,
} as Terminal;
const mate = {
  id: "14",
  location: { latitude: 47.95, longitude: -122.3 },
  mates: [],
  name: "Mukilteo",
  routes: {},
  vesselWatchUrl: null,
} as Terminal;
const seededVessel = {
  abbreviation: "SEA",
  heading: 90,
  id: "1",
  inMaintenance: false,
  inService: true,
  isAtDock: false,
  location: { latitude: 47.96, longitude: -122.33 },
  name: "Sealth",
  speed: 10,
} as Vessel;
const freshVessel = {
  ...seededVessel,
  abbreviation: "CHE",
  id: "2",
  name: "Chetzemoka",
} as Vessel;
const offRouteVessel = {
  ...seededVessel,
  abbreviation: "OFF",
  id: "off-route",
  name: "Off Route Fleet Vessel",
} as Vessel;
const replacementVessel = {
  ...seededVessel,
  abbreviation: "TOK",
  id: "3",
  name: "Tokitae",
} as Vessel;
const nextTerminal = {
  ...terminal,
  id: "1",
  mates: [
    {
      id: "10",
      location: { latitude: 48.53, longitude: -123.01 },
      name: "Friday Harbor",
    },
  ],
  name: "Anacortes",
  routes: {
    route: {
      abbreviation: "ANA-SJ",
      description: "Anacortes / San Juan Islands",
      id: "next-route",
      terminalIds: ["1", "10"],
    },
  },
} as Terminal;
const nextMate = {
  ...mate,
  id: "10",
  name: "Friday Harbor",
} as Terminal;
const observedAt = "2026-07-29T12:00:00.000Z";
const sourceUpdatedAt = "2026-07-29T11:00:00.000Z";
const initialIdentity = "clinton-mukilteo-map";
const seededFreshnessTimestamp = String(Date.parse(sourceUpdatedAt) / 1000);
const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/clinton/mukilteo/map",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/clinton/mukilteo/map",
    description: "Map",
    robots: "index,follow",
    title: "Map",
  },
  normalizedUrl: { path: "/clinton/mukilteo/map", query: {} },
  renderedAt: observedAt,
  routeId: "mate-map",
  routeParams: { mateSlug: "mukilteo", terminalSlug: "clinton" },
  sources: {
    vessels: {
      observedAt,
      outcome: "stale-usable",
      sourceUpdatedAt,
      value: [seededVessel],
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as PublicSsrSnapshot;

function freshnessTimestamp(container: HTMLElement): string | null {
  return (
    container
      .querySelector('[aria-label="vessel freshness"]')
      ?.getAttribute("data-source-updated-at") ?? null
  );
}

// render one map route
const view = (
  routeSnapshot = snapshot,
  path = "/clinton/mukilteo/map",
  routeTerminal = terminal
) =>
  React.createElement(
    PublicSsrSeedProvider,
    { snapshot: routeSnapshot },
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Map, {
        mate,
        requestIdentity: initialIdentity,
        setRoute: () => undefined,
        terminal: routeTerminal,
        vesselIdentity: "",
        vessels: [],
      })
    )
  );

interface NavigationController {
  navigate: () => void;
}

interface AssignmentController {
  assign: (vessels: Vessel[]) => void;
}

const assignmentView = (
  controller: AssignmentController,
  routeSnapshot: PublicSsrSnapshot
) => {
  const Harness = () => {
    const [assignment, setAssignment] = React.useState<{
      identity: string;
      vessels: Vessel[];
    }>({ identity: "", vessels: [] });
    controller.assign = (vessels) => {
      setAssignment(getVesselAssignmentSet(vessels));
    };
    return React.createElement(Map, {
      mate,
      requestIdentity: initialIdentity,
      setRoute: () => undefined,
      terminal,
      vesselIdentity: assignment.identity,
      vessels: assignment.vessels,
    });
  };

  return React.createElement(
    PublicSsrSeedProvider,
    { snapshot: routeSnapshot },
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/clinton/mukilteo/map"] },
      React.createElement(Harness)
    )
  );
};

const navigableView = (controller: NavigationController) => {
  const Harness = () => {
    const navigate = useNavigate();
    const [route, setRoute] = React.useState({
      mate,
      requestIdentity: initialIdentity,
      terminal,
      vesselIdentity: "",
      vessels: [] as Vessel[],
    });
    controller.navigate = () => {
      const assignment = getVesselAssignmentSet([freshVessel]);
      setRoute({
        mate: nextMate,
        requestIdentity: "anacortes-friday-map",
        terminal: nextTerminal,
        vesselIdentity: assignment.identity,
        vessels: assignment.vessels,
      });
      navigate("/anacortes/friday/map");
    };
    return React.createElement(Map, {
      ...route,
      setRoute: () => undefined,
    });
  };

  return React.createElement(
    PublicSsrSeedProvider,
    { snapshot },
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/clinton/mukilteo/map"] },
      React.createElement(Harness)
    )
  );
};

const queryNavigableView = (controller: NavigationController) => {
  const Harness = () => {
    const navigate = useNavigate();
    const location = React.useRef(initialIdentity);
    controller.navigate = () => {
      location.current = "clinton-mukilteo-map-date";
      navigate("/clinton/mukilteo/map?date=2026-08-14");
    };
    return React.createElement(Map, {
      mate,
      requestIdentity: location.current,
      setRoute: () => undefined,
      terminal,
      vesselIdentity: "",
      vessels: [seededVessel],
    });
  };

  return React.createElement(
    PublicSsrSeedProvider,
    { snapshot },
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/clinton/mukilteo/map"] },
      React.createElement(Harness)
    )
  );
};

describe("map hydration seed freshness", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mocks.deferMapLoad = false;
    mocks.maps.length = 0;
    mocks.theme = "light";
  });

  // skip incomplete terminal payloads
  it("skips a terminal mate without runtime location data", async () => {
    const incompleteTerminal = {
      ...terminal,
      mates: [{ id: "14", name: "Mukilteo" } as Terminal],
    } as Terminal;
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        view(snapshot, "/clinton/mukilteo/map", incompleteTerminal)
      );
      await Promise.resolve();
    });

    expect(mocks.maps).toHaveLength(1);
    expect(container.textContent).toContain("Clinton");
  });

  it("ignores a late load event from a map removed during a theme change", async () => {
    mocks.deferMapLoad = true;
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view());
      await Promise.resolve();
    });
    const firstMap = mocks.maps[0];

    mocks.theme = "dark";
    await act(async () => {
      root?.render(view());
      await Promise.resolve();
    });
    const secondMap = mocks.maps[1];

    expect(firstMap.removed).toBe(true);
    expect(secondMap.removed).toBe(false);
    await act(async () => firstMap.triggerLoad());
    await act(async () => secondMap.triggerLoad());
    expect(container.textContent).toContain(seededVessel.name);
  });

  it("retains the matching snapshot timestamp while vessel refresh is pending and rejected", async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    mocks.getVesselSnapshot.mockReturnValue(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view());
      await Promise.resolve();
    });

    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);

    await act(async () => {
      rejectRefresh(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);
  });

  it("does not advance freshness when a current-route refresh has no matching vessels", async () => {
    let resolveRefresh:
      | ((value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void)
      | undefined;
    mocks.getVesselSnapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view());
      await Promise.resolve();
    });
    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);

    await act(async () => {
      resolveRefresh?.({ sourceUpdatedAt: 2_000_000_000, vessels: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);
  });

  it("keeps a subsequent whole-fleet refresh scoped to seeded route vessel identities", async () => {
    mocks.getVesselSnapshot.mockResolvedValue({
      sourceUpdatedAt: 2_000_000_000,
      vessels: [{ ...seededVessel, name: "Sealth refreshed" }, offRouteVessel],
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Sealth refreshed");
    expect(container.textContent).not.toContain(offRouteVessel.name);
    expect(freshnessTimestamp(container)).toBe("2000000000");
  });

  it("replaces seeded A with live assignment B before filtering fleet A/B/C", async () => {
    let resolveRefresh:
      | ((value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void)
      | undefined;
    mocks.getVesselSnapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, snapshot));
      await Promise.resolve();
    });
    expect(container.textContent).toContain(seededVessel.name);

    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(freshVessel.name);
    expect(container.textContent).not.toContain(seededVessel.name);
    expect(freshnessTimestamp(container)).toBeNull();

    await act(async () => {
      resolveRefresh?.({
        sourceUpdatedAt: 2_000_000_000,
        vessels: [
          { ...seededVessel, name: "Sealth refreshed" },
          { ...freshVessel, name: "Chetzemoka refreshed" },
          offRouteVessel,
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Chetzemoka refreshed");
    expect(container.textContent).not.toContain("Sealth refreshed");
    expect(container.textContent).not.toContain(offRouteVessel.name);
    expect(freshnessTimestamp(container)).toBe("2000000000");
  });

  it("allows live assignment B after an authoritative empty seed and filters fleet A/B/C", async () => {
    let resolveRefresh:
      | ((value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void)
      | undefined;
    mocks.getVesselSnapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const emptySnapshot = {
      ...snapshot,
      sources: {
        vessels: {
          observedAt,
          outcome: "empty",
          sourceUpdatedAt,
          value: [],
        },
      },
    } as PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, emptySnapshot));
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(freshVessel.name);

    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    await act(async () => {
      resolveRefresh?.({
        sourceUpdatedAt: 2_000_000_000,
        vessels: [seededVessel, freshVessel, offRouteVessel],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(freshVessel.name);
    expect(container.textContent).not.toContain(seededVessel.name);
    expect(container.textContent).not.toContain(offRouteVessel.name);
    expect(freshnessTimestamp(container)).toBe("2000000000");
  });

  it("deduplicates repeated schedule vessel assignments by id", () => {
    const assignments = getVesselAssignmentSet([
      freshVessel,
      replacementVessel,
      { ...freshVessel, name: "Duplicate Chetzemoka slot" },
    ]);

    expect(assignments.vessels).toEqual([freshVessel, replacementVessel]);
    expect(assignments.identity).toBe('assignments:["2","3"]');
    expect(
      getVesselAssignmentSet([replacementVessel, freshVessel]).identity
    ).toBe(assignments.identity);
  });

  it("does not force or restart vessel polling when assignments change", async () => {
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, snapshot));
      await Promise.resolve();
    });
    expect(mocks.getVesselSnapshot).toHaveBeenCalledOnce();
    expect(mocks.refreshVessels).not.toHaveBeenCalled();

    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    expect(mocks.getVesselSnapshot).toHaveBeenCalledOnce();
    expect(mocks.refreshVessels).not.toHaveBeenCalled();
  });

  it("selects a new same-route assignment with null freshness before state reconciliation", () => {
    const nextAssignments = getVesselAssignmentSet([
      replacementVessel,
      { ...replacementVessel, name: "Duplicate Tokitae slot" },
    ]);

    expect(
      selectVisibleVesselContent({
        current: {
          routeKey: initialIdentity,
          sourceUpdatedAt: 2_000_000_001,
          vesselIdentity: getVesselAssignmentSet([freshVessel]).identity,
          vessels: [{ ...freshVessel, name: "Fleet-refreshed B" }],
        },
        routeKey: initialIdentity,
        seededSourceUpdatedAt: Number(seededFreshnessTimestamp),
        seededVessels: [seededVessel],
        vesselIdentity: nextAssignments.identity,
        vessels: nextAssignments.vessels,
      })
    ).toEqual({
      sourceUpdatedAt: null,
      vessels: [replacementVessel],
    });
  });

  it("clears fleet freshness when live assignments change within the same route and date", async () => {
    const refreshResolvers: Array<
      (value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void
    > = [];
    mocks.getVesselSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          refreshResolvers.push(resolve);
        })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, snapshot));
      await Promise.resolve();
    });
    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    await act(async () => {
      refreshResolvers[0]?.({
        sourceUpdatedAt: 2_000_000_001,
        vessels: [freshVessel],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(freshVessel.name);
    expect(freshnessTimestamp(container)).toBe("2000000001");

    await act(async () => {
      controller.assign([replacementVessel]);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(replacementVessel.name);
    expect(container.textContent).not.toContain(freshVessel.name);
    expect(freshnessTimestamp(container)).toBeNull();
  });

  it("preserves refreshed content and freshness when the live assignment set is unchanged", async () => {
    const refreshResolvers: Array<
      (value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void
    > = [];
    mocks.getVesselSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          refreshResolvers.push(resolve);
        })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, snapshot));
      await Promise.resolve();
    });
    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    await act(async () => {
      refreshResolvers[0]?.({
        sourceUpdatedAt: 2_000_000_001,
        vessels: [{ ...freshVessel, name: "Fleet-refreshed B" }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Fleet-refreshed B");
    expect(freshnessTimestamp(container)).toBe("2000000001");

    await act(async () => {
      controller.assign([{ ...freshVessel, name: "Schedule-rerendered B" }]);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Fleet-refreshed B");
    expect(container.textContent).not.toContain("Schedule-rerendered B");
    expect(freshnessTimestamp(container)).toBe("2000000001");
  });

  it("does not let an old in-flight fleet refresh overwrite a new assignment", async () => {
    const refreshResolvers: Array<
      (value: { sourceUpdatedAt: number; vessels: Vessel[] }) => void
    > = [];
    mocks.getVesselSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          refreshResolvers.push(resolve);
        })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: AssignmentController = {
      assign: () => undefined,
    };

    await act(async () => {
      root?.render(assignmentView(controller, snapshot));
      await Promise.resolve();
    });
    await act(async () => {
      controller.assign([freshVessel]);
      await Promise.resolve();
    });
    await act(async () => {
      controller.assign([replacementVessel]);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(replacementVessel.name);

    await act(async () => {
      refreshResolvers[0]?.({
        sourceUpdatedAt: 2_000_000_001,
        vessels: [{ ...freshVessel, name: "Stale refreshed B" }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(replacementVessel.name);
    expect(container.textContent).not.toContain("Stale refreshed B");
    expect(freshnessTimestamp(container)).toBeNull();
  });

  it("does not expose a snapshot timestamp on a mismatched route", async () => {
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(snapshot, "/clinton/map"));
      await Promise.resolve();
    });

    expect(freshnessTimestamp(container)).toBeNull();
  });

  it("accepts a terminal map snapshot when the browser supplies its default mate", async () => {
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const terminalSnapshot = {
      ...snapshot,
      canonicalPath: "/clinton/map",
      normalizedUrl: { path: "/clinton/map", query: {} },
      routeId: "terminal-map",
      routeParams: { terminalSlug: "clinton" },
    } as PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(view(terminalSnapshot, "/clinton/map"));
      await Promise.resolve();
    });

    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);
  });

  it("synchronously discards prior vessel content and freshness on same-tree route navigation", async () => {
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: NavigationController = {
      navigate: () => undefined,
    };

    await act(async () => {
      root?.render(navigableView(controller));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(seededVessel.name);
    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);

    await act(async () => {
      controller.navigate();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(freshVessel.name);
    expect(container.textContent).not.toContain(seededVessel.name);
    expect(freshnessTimestamp(container)).toBeNull();
  });

  it("synchronously discards prior vessel content and freshness on query navigation", async () => {
    mocks.getVesselSnapshot.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const controller: NavigationController = {
      navigate: () => undefined,
    };

    await act(async () => {
      root?.render(queryNavigableView(controller));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(seededVessel.name);
    expect(freshnessTimestamp(container)).toBe(seededFreshnessTimestamp);

    await act(async () => {
      controller.navigate();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(seededVessel.name);
    expect(freshnessTimestamp(container)).toBeNull();
  });
});
