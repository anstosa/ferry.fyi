import "mapbox-gl/dist/mapbox-gl.css";

import { Map as Mapbox, type MapEventOf, NavigationControl } from "mapbox-gl";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import type { TerminalPoint } from "shared/contracts/terminalLocations";

export type TerminalPointKind = "booth" | "dock";

interface Props {
  booth: TerminalPoint | null;
  defaultDock: TerminalPoint | null;
  dock: TerminalPoint | null;
  onChange: (kind: TerminalPointKind, point: TerminalPoint) => void;
  selected: TerminalPointKind;
  terminalId: string;
}

interface MapMovement extends TerminalPoint {
  selected: TerminalPointKind;
  terminalId: string;
}

const FALLBACK_CENTER: [number, number] = [-122.3, 47.5];

// read the coordinate under the fixed center crosshair
const centerPoint = (map: Mapbox): TerminalPoint => {
  const { lat, lng } = map.getCenter();
  return { latitude: lat, longitude: lng };
};

// ignore subpixel projection rounding during camera synchronization
const sameCenter = (left: TerminalPoint, right: TerminalPoint): boolean =>
  Math.abs(left.latitude - right.latitude) < 1e-9 &&
  Math.abs(left.longitude - right.longitude) < 1e-9;

// move satellite imagery underneath the selected point's fixed crosshair
export const TerminalLocationMap = ({
  booth,
  defaultDock,
  dock,
  onChange,
  selected,
  terminalId,
}: Props): ReactElement => {
  const focusPoint =
    selected === "booth"
      ? (booth ?? dock ?? defaultDock)
      : (dock ?? defaultDock ?? booth);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Mapbox | null>(null);
  const movementRef = useRef<MapMovement | null>(null);
  const settledCenterRef = useRef<TerminalPoint | null>(null);
  const syncingCameraRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const targetRef = useRef({ selected, terminalId });
  const focusPointRef = useRef(focusPoint);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  focusPointRef.current = focusPoint;
  onChangeRef.current = onChange;
  targetRef.current = { selected, terminalId };

  // create one map load for the mounted editor
  useEffect(() => {
    // require both a target and the existing mapbox token
    if (!containerRef.current || !process.env.MAPBOX_ACCESS_TOKEN) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    let instance: Mapbox;
    try {
      instance = new Mapbox({
        accessToken: process.env.MAPBOX_ACCESS_TOKEN,
        center: focusPointRef.current
          ? [focusPointRef.current.longitude, focusPointRef.current.latitude]
          : FALLBACK_CENTER,
        container: containerRef.current,
        // retain satellite imagery in every app theme
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        zoom: focusPointRef.current ? 13 : 6,
      });
    } catch {
      setUnavailable(true);
      return;
    }
    mapRef.current = instance;
    settledCenterRef.current = centerPoint(instance);
    instance.addControl(new NavigationControl({ showCompass: false }));
    // publish the loaded map instance
    const handleLoad = (): void => {
      // publish only the active map
      if (mapRef.current === instance) {
        setUnavailable(false);
        setMap(instance);
      }
    };
    // expose a manual editing fallback
    const handleError = (): void => {
      // preserve manual editing when mapbox cannot load
      if (!instance.loaded()) {
        setUnavailable(true);
      }
    };
    // bind a map gesture to the terminal and target that started it
    const handleMoveStart = (
      event: MapEventOf<"movestart"> & {
        terminalLocationSync?: boolean;
      }
    ): void => {
      // exclude initialization and controlled camera movements
      if (event.terminalLocationSync || syncingCameraRef.current) {
        movementRef.current = null;
        return;
      }
      movementRef.current = {
        ...targetRef.current,
        // mapbox may move the camera before emitting movestart
        ...(settledCenterRef.current ?? centerPoint(instance)),
      };
    };
    // apply the final center only to the same selected draft
    const handleMoveEnd = (
      event: MapEventOf<"moveend"> & {
        terminalLocationSync?: boolean;
      }
    ): void => {
      const movement = movementRef.current;
      movementRef.current = null;
      const point = centerPoint(instance);
      // retain the baseline even when a gesture cannot edit this draft
      if (mapRef.current === instance) {
        settledCenterRef.current = point;
      }
      // ignore controlled recentering and gestures from a previous selection
      if (
        event.terminalLocationSync ||
        syncingCameraRef.current ||
        mapRef.current !== instance ||
        !movement ||
        movement.selected !== targetRef.current.selected ||
        movement.terminalId !== targetRef.current.terminalId
      ) {
        return;
      }
      // leave empty points untouched when only zoom or rotation changes
      if (!sameCenter(movement, point)) {
        onChangeRef.current(movement.selected, point);
      }
    };
    instance.on("load", handleLoad);
    instance.on("error", handleError);
    instance.on("movestart", handleMoveStart);
    instance.on("moveend", handleMoveEnd);
    // remove all mapbox resources
    return () => {
      instance.off("load", handleLoad);
      instance.off("error", handleError);
      instance.off("movestart", handleMoveStart);
      instance.off("moveend", handleMoveEnd);
      movementRef.current = null;
      settledCenterRef.current = null;
      mapRef.current = null;
      setMap(null);
      instance.remove();
    };
  }, []);

  // align the crosshair with the active point or manual coordinate changes
  useEffect(() => {
    // wait for a loaded map and terminal point
    if (!map || !focusPoint) {
      return;
    }
    // preserve the user's zoom and avoid an update feedback loop
    if (sameCenter(centerPoint(map), focusPoint)) {
      return;
    }
    syncingCameraRef.current = true;
    movementRef.current = null;
    try {
      map.stop();
      map.easeTo(
        {
          center: [focusPoint.longitude, focusPoint.latitude],
          duration: 0,
        },
        { terminalLocationSync: true }
      );
    } finally {
      settledCenterRef.current = centerPoint(map);
      syncingCameraRef.current = false;
    }
  }, [focusPoint?.latitude, focusPoint?.longitude, map, selected, terminalId]);

  const dockFallback = selected === "dock" && !dock && Boolean(defaultDock);
  let crosshairColor = selected === "booth" ? "#9b2c2c" : "#276749";
  // distinguish the unsaved wsf dock position
  if (dockFallback) {
    crosshairColor = "#4a5568";
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-light bg-gray-lightest dark:border-gray-dark dark:bg-blue-darkest">
      <div
        aria-label="Terminal location map"
        className="h-72 w-full"
        ref={containerRef}
      />
      {!unavailable && (
        <svg
          aria-label={`${selected === "booth" ? "Booth" : "Dock"} point crosshair${
            dockFallback ? " (WSF fallback)" : ""
          }`}
          className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2"
          fill="none"
          role="img"
          viewBox="0 0 40 40"
        >
          <path d="M20 2v36M2 20h36" stroke="white" strokeWidth="6" />
          <path d="M20 2v36M2 20h36" stroke={crosshairColor} strokeWidth="3" />
        </svg>
      )}
      {unavailable && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-gray-lightest/95 p-6 text-center text-sm text-gray-dark dark:bg-blue-darkest/95 dark:text-gray-light"
          role="status"
        >
          The map is unavailable. Enter latitude and longitude below.
        </div>
      )}
    </div>
  );
};
