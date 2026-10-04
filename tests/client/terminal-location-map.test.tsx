// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mapbox = vi.hoisted(() => {
  class FakeMap {
    events = new globalThis.Map<string, Function>();
    removed = false;
    canvas = document.createElement("canvas");
    center: { lat: number; lng: number };
    zoom: number;
    addControl = vi.fn();
    stop = vi.fn();

    // retain map construction inputs
    constructor(
      readonly options: {
        center: [number, number];
        style: string;
        zoom: number;
      }
    ) {
      this.center = { lat: options.center[1], lng: options.center[0] };
      this.zoom = options.zoom;
    }

    // emit camera events for controlled map repositioning
    easeTo = vi.fn(
      (
        options: { center: [number, number]; zoom?: number },
        eventData = {}
      ) => {
        this.emit("movestart", eventData);
        this.center = { lat: options.center[1], lng: options.center[0] };
        this.zoom = options.zoom ?? this.zoom;
        this.emit("moveend", eventData);
      }
    );

    // register one map event
    on(event: string, handler: Function): void {
      this.events.set(event, handler);
    }

    // release one map event
    off(event: string): void {
      this.events.delete(event);
    }

    // emit one test map event
    emit(event: string, value: unknown = {}): void {
      this.events.get(event)?.(value);
    }

    // read the coordinate underneath the center crosshair
    getCenter(): { lat: number; lng: number } {
      return this.center;
    }

    // expose the interactive map canvas
    getCanvas(): HTMLCanvasElement {
      return this.canvas;
    }

    // report a loaded fixture map
    loaded(): boolean {
      return true;
    }

    // mark mapbox cleanup
    remove(): void {
      this.removed = true;
    }
  }

  return { FakeMap, maps: [] as FakeMap[], theme: "light" as "light" | "dark" };
});

vi.mock("mapbox-gl", () => ({
  Map: class extends mapbox.FakeMap {
    // retain each created map
    constructor(options: {
      center: [number, number];
      style: string;
      zoom: number;
    }) {
      super(options);
      mapbox.maps.push(this);
    }
  },
  NavigationControl: class {},
}));
vi.mock("~/lib/theme", () => ({
  // expose the current fixture theme
  useResolvedTheme: () => mapbox.theme,
}));

import { TerminalLocationMap } from "../../client/components/admin/TerminalLocationMap";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onChange: ReturnType<typeof vi.fn>;
const originalToken = process.env.MAPBOX_ACCESS_TOKEN;
const defaultDock = { latitude: 47.98, longitude: -122.35 };

// rerender the map without changing its mounted identity
const renderMap = (
  props: Partial<React.ComponentProps<typeof TerminalLocationMap>> = {}
): void => {
  act(() => {
    root.render(
      <TerminalLocationMap
        booth={null}
        defaultDock={defaultDock}
        dock={null}
        onChange={onChange}
        selected="booth"
        terminalId="5"
        {...props}
      />
    );
  });
};

// finish a user movement underneath the crosshair
const panTo = (lat: number, lng: number): void => {
  act(() => {
    const map = mapbox.maps[0];
    map.emit("movestart");
    map.center = { lat, lng };
    map.emit("moveend");
  });
};

// mount one satellite-map editor fixture
beforeEach(() => {
  process.env.MAPBOX_ACCESS_TOKEN = "test-token";
  mapbox.maps.length = 0;
  mapbox.theme = "light";
  onChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderMap();
  act(() => mapbox.maps[0].emit("load"));
});

// release each map fixture
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  process.env.MAPBOX_ACCESS_TOKEN = originalToken;
});

describe("terminal location map", () => {
  // keep satellite imagery and the map instance when the theme changes
  it("always uses satellite imagery independently of the app theme", () => {
    const map = mapbox.maps[0];
    expect(map.options.style).toBe(
      "mapbox://styles/mapbox/satellite-streets-v12"
    );
    mapbox.theme = "dark";
    renderMap();
    expect(mapbox.maps).toHaveLength(1);
    expect(map.removed).toBe(false);
  });

  // leave panning gestures accessible through a centered crosshair overlay
  it("shows a fixed crosshair instead of interactive circle markers", () => {
    const crosshair = container.querySelector(
      '[aria-label="Booth point crosshair"]'
    );
    expect(crosshair?.tagName.toLowerCase()).toBe("svg");
    expect(crosshair?.getAttribute("class")).toContain("pointer-events-none");
    expect(crosshair?.getAttribute("class")).toContain("left-1/2 top-1/2");
    expect(crosshair?.getAttribute("class")).toContain(
      "-translate-x-1/2 -translate-y-1/2"
    );
    expect(crosshair?.querySelector("circle")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  // write only the selected target after the underlying map moves
  it("updates the selected point from the final map center", () => {
    panTo(47.91, -122.31);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("booth", {
      latitude: 47.91,
      longitude: -122.31,
    });

    onChange.mockClear();
    renderMap({
      selected: "dock",
      dock: { latitude: 47.92, longitude: -122.32 },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(mapbox.maps[0].getCenter()).toEqual({ lat: 47.92, lng: -122.32 });
    panTo(47.93, -122.33);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("dock", {
      latitude: 47.93,
      longitude: -122.33,
    });
  });

  // mapbox can update the camera before its first movement event
  it("records a pan completed in a single movement frame", () => {
    act(() => {
      const map = mapbox.maps[0];
      map.center = { lat: 47.91, lng: -122.31 };
      map.emit("movestart");
      map.emit("moveend");
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("booth", {
      latitude: 47.91,
      longitude: -122.31,
    });
  });

  // retain an unsaved fallback until the selected map center actually moves
  it("distinguishes the dock fallback without creating a draft on load or zoom", () => {
    renderMap({ selected: "dock" });
    expect(
      container.querySelector(
        '[aria-label="Dock point crosshair (WSF fallback)"]'
      )
    ).not.toBeNull();
    act(() => {
      mapbox.maps[0].emit("movestart");
      mapbox.maps[0].zoom = 17;
      mapbox.maps[0].emit("moveend");
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // ignore map and overlay clicks as placement actions
  it("does not place points by clicking the map or crosshair", () => {
    act(() => {
      mapbox.maps[0].emit("click", { lngLat: { lat: 47.9, lng: -122.3 } });
      container
        .querySelector('[aria-label="Booth point crosshair"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // recenter manual edits without echoing them back into drafts
  it("centers the active coordinate changes and preserves the zoom", () => {
    const map = mapbox.maps[0];
    map.zoom = 17;
    renderMap({ booth: { latitude: 47.9, longitude: -122.3 } });
    expect(map.getCenter()).toEqual({ lat: 47.9, lng: -122.3 });
    expect(map.zoom).toBe(17);
    expect(onChange).not.toHaveBeenCalled();

    map.easeTo.mockClear();
    panTo(47.89, -122.29);
    renderMap({ booth: { latitude: 47.89, longitude: -122.29 } });
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  // discard movements that started for a different target
  it("does not apply an old pan after switching targets or terminals", () => {
    const map = mapbox.maps[0];
    act(() => map.emit("movestart"));
    renderMap({ selected: "dock", terminalId: "14" });
    act(() => {
      map.center = { lat: 47.94, lng: -122.34 };
      map.emit("moveend");
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // suppress the prior gesture when a manual recenter interrupts it
  it("does not write a pending movement stopped by programmatic recentering", () => {
    const map = mapbox.maps[0];
    act(() => map.emit("movestart"));
    map.stop.mockImplementation(() => map.emit("moveend"));
    renderMap({ booth: { latitude: 47.9, longitude: -122.3 } });
    expect(onChange).not.toHaveBeenCalled();
  });

  // release movement handlers and map resources on unmount
  it("cleans up the centered editor", () => {
    const map = mapbox.maps[0];
    act(() => root.unmount());
    expect(map.removed).toBe(true);
    expect(map.events.size).toBe(0);
    root = createRoot(container);
  });
});
