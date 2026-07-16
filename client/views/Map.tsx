import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  LngLatBounds,
  Map as Mapbox,
  Marker,
  NavigationControl,
} from "mapbox-gl";
import React, {
  CSSProperties,
  MouseEvent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { Route } from "shared/contracts/routes";
import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";

import { FreshnessPill } from "~/components/FreshnessPill";
import { ReloadButton } from "~/components/ReloadButton";
import { Toast } from "~/components/Toast";
import { useGeo } from "~/lib/geo";
import { knotsToMph } from "~/lib/speed";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useResolvedTheme } from "~/lib/theme";
import { refreshVessels } from "~/lib/vessels";
import { useWindowSize } from "~/lib/window";
import CaretDownIcon from "~/static/images/icons/solid/caret-down.svg";
import CaretUpIcon from "~/static/images/icons/solid/caret-up.svg";
import UserLocationIcon from "~/static/images/icons/solid/location.svg";
import VesselIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapPinIcon from "~/static/images/icons/solid/map-marker.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { Header } from "./Header";

const DEFAULT_TOP = 47;
const DEFAULT_LEFT = -121;
const DEFAULT_BOTTOM = 49;
const DEFAULT_RIGHT = -123;
const ABBREVIATION_BREAKPOINT = 350;
const VESSEL_REFRESH_MS = 60 * 1000;
const VESSEL_ANIMATION_MS = 1000;
const METERS_PER_NAUTICAL_MILE = 1852;
const MARKER_LABEL_FIT_PADDING = { bottom: 112, left: 96, right: 96, top: 112 };
const LABEL_PLACEMENTS = {
  above: "bottom-full left-1/2 mb-1 -translate-x-1/2",
  below: "top-full left-1/2 mt-1 -translate-x-1/2",
  left: "right-full top-1/2 mr-1 -translate-y-1/2",
  right: "left-full top-1/2 ml-1 -translate-y-1/2",
} as const;
const MAP_LABEL_MARGIN = 4;
const MAP_MARKER_SIZE = 30;
const MAP_LABEL_HEIGHT = 26;

interface Props {
  mate: Terminal | null;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal | null;
  vessels: Vessel[];
}

interface MarkerLabelProps {
  icon: ReactElement;
  iconClassName: string;
  iconStyle?: CSSProperties;
  label: string | null;
  labelClassName?: string;
  labelPlacement: string;
}

interface RenderedMarker {
  marker: Marker;
  root: ReturnType<typeof createRoot>;
  vesselId?: string;
}

interface RouteOption {
  mate: Terminal;
  route: Route;
  terminal: Terminal;
}

interface RouteDropdownProps {
  isOpen: boolean;
  onSelect: (event: MouseEvent, option: RouteOption) => void;
  options: RouteOption[];
  selectedLabel: string;
  setOpen: (state: boolean) => void;
}

type LocatedVessel = Vessel & { location: NonNullable<Vessel["location"]> };
type LabelPlacement = keyof typeof LABEL_PLACEMENTS;

interface LabelRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const advanceVesselPosition = (vessel: Vessel): Vessel => {
  if (!vessel.location || vessel.heading === undefined || vessel.speed <= 0) {
    return vessel;
  }
  const distanceMeters =
    (vessel.speed * METERS_PER_NAUTICAL_MILE * VESSEL_ANIMATION_MS) / 3_600_000;
  const headingRadians = (vessel.heading * Math.PI) / 180;
  const latitudeRadians = (vessel.location.latitude * Math.PI) / 180;
  const latitudeDelta = (distanceMeters * Math.cos(headingRadians)) / 111_320;
  const longitudeDelta =
    (distanceMeters * Math.sin(headingRadians)) /
    (111_320 * Math.cos(latitudeRadians));
  return {
    ...vessel,
    location: {
      latitude: vessel.location.latitude + latitudeDelta,
      longitude: vessel.location.longitude + longitudeDelta,
    },
  };
};

const labelWidth = (label: string): number =>
  Math.min(220, Math.max(48, label.length * 7 + 16));

const rectsOverlap = (left: LabelRect, right: LabelRect): boolean =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

const isInsideMap = (rect: LabelRect, width: number, height: number): boolean =>
  rect.left >= MAP_LABEL_MARGIN &&
  rect.right <= width - MAP_LABEL_MARGIN &&
  rect.top >= MAP_LABEL_MARGIN &&
  rect.bottom <= height - MAP_LABEL_MARGIN;

const getLabelRect = (
  x: number,
  y: number,
  label: string,
  placement: LabelPlacement,
  markerAnchor: "bottom" | "center"
): LabelRect => {
  const width = labelWidth(label);
  const markerTop =
    markerAnchor === "bottom" ? y - MAP_MARKER_SIZE : y - MAP_MARKER_SIZE / 2;
  const markerBottom = markerAnchor === "bottom" ? y : y + MAP_MARKER_SIZE / 2;
  if (placement === "above") {
    return {
      bottom: markerTop - 4,
      left: x - width / 2,
      right: x + width / 2,
      top: markerTop - 4 - MAP_LABEL_HEIGHT,
    };
  }
  if (placement === "below") {
    return {
      bottom: markerBottom + 4 + MAP_LABEL_HEIGHT,
      left: x - width / 2,
      right: x + width / 2,
      top: markerBottom + 4,
    };
  }
  if (placement === "left") {
    return {
      bottom: y + MAP_LABEL_HEIGHT / 2,
      left: x - MAP_MARKER_SIZE / 2 - 4 - width,
      right: x - MAP_MARKER_SIZE / 2 - 4,
      top: y - MAP_LABEL_HEIGHT / 2,
    };
  }
  return {
    bottom: y + MAP_LABEL_HEIGHT / 2,
    left: x + MAP_MARKER_SIZE / 2 + 4,
    right: x + MAP_MARKER_SIZE / 2 + 4 + width,
    top: y - MAP_LABEL_HEIGHT / 2,
  };
};

const getVesselLabelPlacement = (
  x: number,
  y: number,
  label: string,
  occupied: LabelRect[],
  mapWidth: number,
  mapHeight: number
): LabelPlacement | null => {
  for (const placement of ["above", "below", "right", "left"] as const) {
    const rect = getLabelRect(x, y, label, placement, "center");
    if (
      isInsideMap(rect, mapWidth, mapHeight) &&
      !occupied.some((item) => rectsOverlap(rect, item))
    ) {
      occupied.push(rect);
      return placement;
    }
  }
  return null;
};

// route option label
const getRouteLabel = (route: Route): string => route.description;

// route option short label
const getRouteShortLabel = (route: Route): string => route.abbreviation;

// active route lookup
const getActiveRoute = (
  terminal: Terminal | null,
  mate: Terminal | null
): Route | null => {
  // missing route context guard
  if (!terminal || !mate) {
    return null;
  }
  return (
    Object.values(terminal.routes ?? {}).find(({ terminalIds }) => {
      // selected route match
      return terminalIds.includes(terminal.id) && terminalIds.includes(mate.id);
    }) ?? null
  );
};

// collect unique route choices
const getRouteOptions = (
  terminals: Terminal[],
  activeRouteId?: string
): RouteOption[] => {
  const terminalsById = Object.fromEntries(
    terminals.map((terminal) => {
      return [terminal.id, terminal];
    })
  );
  const routesById = new globalThis.Map<string, RouteOption>();
  // terminal route loop
  terminals.forEach((terminal) => {
    // route loop
    Object.values(terminal.routes ?? {}).forEach((route) => {
      // current route guard
      if (route.id === activeRouteId) {
        return;
      }
      // duplicate route guard
      if (routesById.has(route.id)) {
        return;
      }
      const routeTerminals = route.terminalIds
        .map((terminalId) => {
          return terminalsById[terminalId];
        })
        .filter((terminal): terminal is Terminal => Boolean(terminal));
      // incomplete route guard
      if (routeTerminals.length < 2) {
        return;
      }
      routesById.set(route.id, {
        mate: routeTerminals[1],
        route,
        terminal: routeTerminals[0],
      });
    });
  });
  return Array.from(routesById.values()).sort((left, right) => {
    // alphabetical route order
    return getRouteLabel(left.route).localeCompare(getRouteLabel(right.route));
  });
};

// route dropdown render
const RouteDropdown = ({
  isOpen,
  onSelect,
  options,
  selectedLabel,
  setOpen,
}: RouteDropdownProps): ReactElement => {
  const { width } = useWindowSize();
  const selectedShortLabel = selectedLabel
    .split(" / ")
    .map((part) => {
      return part.trim()[0];
    })
    .join("/");
  const selectedText =
    width > ABBREVIATION_BREAKPOINT ? selectedLabel : selectedShortLabel;
  // empty options guard
  if (isEmpty(options)) {
    return <span className="truncate">{selectedText}</span>;
  }
  return (
    <div className="relative min-w-0 cursor-pointer">
      <div
        className="flex min-w-0 items-center"
        onClick={() => setOpen(!isOpen)}
        aria-label="Expand Routes"
      >
        <span className="truncate">{selectedText}</span>
        <div
          className={clsx(
            "absolute top-full -mt-1 flex w-full justify-center",
            "text-lighten-medium"
          )}
        >
          {isOpen ? <CaretUpIcon /> : <CaretDownIcon />}
        </div>
      </div>
      {/* route menu backdrop */}
      {isOpen && (
        <div
          className="fixed top-0 left-0 h-screen w-screen cursor-default"
          onClick={() => setOpen(false)}
        />
      )}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={clsx(
              "absolute top-full left-1/2 z-30 -translate-x-1/2",
              "max-h-[calc(100vh-4rem)] overflow-y-auto scrolling-touch",
              "bg-green-dark py-2 shadow-lg"
            )}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut", type: "tween" }}
          >
            <ul>
              {options.map((option) => {
                const { route } = option;
                return (
                  <li key={route.id}>
                    <button
                      className={clsx(
                        "block w-full cursor-pointer whitespace-nowrap",
                        "py-2 px-8 text-left hover:bg-lighten-high"
                      )}
                      type="button"
                      onClick={(event) => onSelect(event, option)}
                    >
                      <span className="max-[350px]:hidden">
                        {getRouteLabel(route)}
                      </span>
                      <span className="hidden max-[350px]:inline">
                        {getRouteShortLabel(route)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// marker label render
const renderMarkerLabel = ({
  icon,
  iconClassName,
  iconStyle,
  label,
  labelClassName,
  labelPlacement,
}: MarkerLabelProps): ReactElement => {
  return (
    <div className="relative flex items-center justify-center pointer-events-auto">
      <div className={iconClassName} style={iconStyle}>
        {icon}
      </div>
      {label && (
        <div
          className={clsx(
            "absolute z-10 border px-2 py-1 text-xs font-bold whitespace-nowrap shadow transform",
            labelClassName ??
              "rounded-full border-[rgba(1,111,82,0.18)] bg-day-normal-light text-gray-dark dark:border-[rgba(255,255,255,0.08)] dark:bg-night-normal-dark dark:text-[#e0f0f4]",
            labelPlacement
          )}
        >
          {label}
        </div>
      )}
    </div>
  );
};

// marker icon render
const renderMarkerIcon = (
  icon: ReactElement,
  marker: HTMLElement
): ReturnType<typeof createRoot> => {
  const root = createRoot(marker);
  root.render(icon);
  return root;
};

// remove rendered markers
const removeRenderedMarkers = (renderedMarkers: RenderedMarker[]): void => {
  // marker cleanup loop
  renderedMarkers.forEach(({ marker, root }) => {
    // Unmount before Mapbox detaches the marker element. Deferring this can
    // make React remove children from an element Mapbox already removed.
    root.unmount();
    marker.remove();
  });
};

// located vessel check
const hasVesselLocation = (vessel: Vessel): vessel is LocatedVessel =>
  Boolean(vessel.location);

// vessel label text
const getVesselLabel = (vessel: Vessel): string => {
  // docked vessel guard
  if (vessel.isAtDock) {
    return `${vessel.name} · docked`;
  }
  const speedMph = Math.round(knotsToMph(vessel.speed));
  // stationary vessel guard
  if (speedMph <= 0) {
    return vessel.name;
  }
  return `${vessel.name} · ${speedMph} mph`;
};

export const Map = ({
  mate,
  setRoute,
  terminal,
  vessels,
}: Props): ReactElement => {
  const mapRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<RenderedMarker[]>([]);
  const lastFittedVesselsRef = useRef<Vessel[] | null>(null);
  const routeVesselIdsRef = useRef(new Set(vessels.map(({ id }) => id)));
  const [displayedVessels, setDisplayedVessels] = useState(vessels);
  const [animatedVessels, setAnimatedVessels] = useState(vessels);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<number | null>(null);
  const [isReloading, setReloading] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const theme = useResolvedTheme();
  const [userLocation] = useGeo();
  const { terminals } = useTerminals();
  const activeRoute = getActiveRoute(terminal, mate);
  const routeOptions = getRouteOptions(terminals, activeRoute?.id);
  const routeLabel =
    activeRoute?.description ??
    (terminal && mate ? `${terminal.name} / ${mate.name}` : "Route");

  useEffect(() => {
    routeVesselIdsRef.current = new Set(vessels.map(({ id }) => id));
    setDisplayedVessels(vessels);
  }, [vessels]);
  // Confirmed API positions replace any client-side prediction.
  useEffect(() => setAnimatedVessels(displayedVessels), [displayedVessels]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setAnimatedVessels((current) => current.map(advanceVesselPosition));
    }, VESSEL_ANIMATION_MS);
    return () => window.clearInterval(interval);
  }, []);

  const reloadVessels = async (): Promise<void> => {
    setReloading(true);
    setRefreshError(false);
    try {
      const refreshed = await refreshVessels();
      setDisplayedVessels((current) => {
        // A map can open before its schedule has populated `current`. Keep
        // that empty startup state from replacing route vessels with an empty
        // refresh result (or, worse, every vessel in the system).
        const routeVesselIds = new Set([
          ...current.map(({ id }) => id),
          ...routeVesselIdsRef.current,
        ]);
        if (routeVesselIds.size === 0) {
          return current;
        }
        return refreshed.vessels.filter(({ id }) => routeVesselIds.has(id));
      });
      setSourceUpdatedAt(refreshed.sourceUpdatedAt);
    } catch (error) {
      setRefreshError(true);
      throw error;
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    reloadVessels().catch(console.error);
    const interval = window.setInterval(() => {
      reloadVessels().catch(console.error);
    }, VESSEL_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  const updateMarkers = (): void => {
    // default coords based on Puget Sound
    let top: number = DEFAULT_TOP;
    let left: number = DEFAULT_LEFT;
    let bottom: number = DEFAULT_BOTTOM;
    let right: number = DEFAULT_RIGHT;

    const maybeUpdateBounds = ({
      lon,
      lat,
    }: {
      lon: number;
      lat: number;
    }): void => {
      // top edge
      if (lat > top) {
        top = lat;
      }
      // left edge
      if (lon < left) {
        left = lon;
      }
      // bottom edge
      if (lat < bottom) {
        bottom = lat;
      }
      // right edge
      if (lon > right) {
        right = lon;
      }
    };

    const newMarkers: RenderedMarker[] = [];

    // map readiness guard
    if (!map || !terminal || !mate) {
      return;
    }

    // remove existing markers
    if (!isEmpty(markersRef.current)) {
      removeRenderedMarkers(markersRef.current);
      markersRef.current = [];
    }

    const mapSize = map.getContainer().getBoundingClientRect();
    const occupied: LabelRect[] = [];
    const addMarkerRect = (x: number, y: number): void => {
      occupied.push({
        bottom: y + MAP_MARKER_SIZE / 2,
        left: x - MAP_MARKER_SIZE / 2,
        right: x + MAP_MARKER_SIZE / 2,
        top: y - MAP_MARKER_SIZE / 2,
      });
    };

    // Keep vessel labels clear of every map marker, including the user's dot.
    displayedVessels.filter(hasVesselLocation).forEach((vessel) => {
      const point = map.project([
        vessel.location.longitude,
        vessel.location.latitude,
      ]);
      addMarkerRect(point.x, point.y);
    });
    if (userLocation) {
      const point = map.project([
        userLocation.longitude,
        userLocation.latitude,
      ]);
      addMarkerRect(point.x, point.y);
      occupied.push(getLabelRect(point.x, point.y, "You", "above", "center"));
    }

    // add terminal markers
    newMarkers.push(
      ...[terminal, ...(terminal.mates || [])].map((targetTerminal) => {
        const marker = document.createElement("div");
        const lngLat = {
          lon: targetTerminal.location.longitude,
          lat: targetTerminal.location.latitude,
        };
        const point = map.project([lngLat.lon, lngLat.lat]);
        const terminalLabelRect = getLabelRect(
          point.x,
          point.y,
          targetTerminal.name,
          "below",
          "bottom"
        );
        addMarkerRect(point.x, point.y);
        occupied.push(terminalLabelRect);
        maybeUpdateBounds(lngLat);
        const root = renderMarkerIcon(
          renderMarkerLabel({
            icon: <MapPinIcon />,
            iconClassName: "text-3xl text-green-dark drop-shadow",
            label: targetTerminal.name,
            labelClassName:
              "rounded-none border-green-dark bg-green-dark text-white",
            labelPlacement: LABEL_PLACEMENTS.below,
          }),
          marker
        );
        return {
          marker: new Marker({ anchor: "bottom", element: marker })
            .setLngLat(lngLat)
            .addTo(map),
          root,
        };
      })
    );

    // add vessel markers
    newMarkers.push(
      ...displayedVessels.filter(hasVesselLocation).map((vessel) => {
        const marker = document.createElement("div");
        const heading = (vessel.heading ?? 0) - 45;
        const lngLat = {
          lon: vessel.location.longitude,
          lat: vessel.location.latitude,
        };
        const label = getVesselLabel(vessel);
        const point = map.project([lngLat.lon, lngLat.lat]);
        const placement = getVesselLabelPlacement(
          point.x,
          point.y,
          label,
          occupied,
          mapSize.width,
          mapSize.height
        );
        maybeUpdateBounds(lngLat);
        const root = renderMarkerIcon(
          renderMarkerLabel({
            icon: <VesselIcon />,
            iconClassName: "text-3xl text-countdown drop-shadow",
            iconStyle: { transform: `rotate(${heading}deg)` },
            label: placement ? label : null,
            labelClassName:
              "rounded-full border-countdown bg-countdown text-white",
            labelPlacement: placement ? LABEL_PLACEMENTS[placement] : "",
          }),
          marker
        );
        return {
          marker: new Marker({ anchor: "center", element: marker })
            .setLngLat(lngLat)
            .addTo(map),
          root,
          vesselId: vessel.id,
        };
      })
    );

    // user location marker
    if (userLocation) {
      const marker = document.createElement("div");
      const lngLat = {
        lon: userLocation.longitude,
        lat: userLocation.latitude,
      };
      const root = renderMarkerIcon(
        renderMarkerLabel({
          icon: <UserLocationIcon />,
          iconClassName: "text-2xl text-blue-dark drop-shadow",
          label: "You",
          labelPlacement: LABEL_PLACEMENTS.above,
        }),
        marker
      );
      newMarkers.push({
        marker: new Marker({ anchor: "center", element: marker })
          .setLngLat(lngLat)
          .addTo(map),
        root,
      });
    }

    markersRef.current = newMarkers;

    // fit map to route markers
    if (lastFittedVesselsRef.current !== displayedVessels) {
      map.fitBounds(
        new LngLatBounds({ lat: bottom, lon: left }, { lat: top, lon: right }),
        { padding: MARKER_LABEL_FIT_PADDING }
      );
      lastFittedVesselsRef.current = displayedVessels;
    }
  };

  // update markers when anything changes
  useEffect(updateMarkers, [
    map,
    displayedVessels,
    terminal,
    mate,
    userLocation,
  ]);

  // Move the existing DOM markers during dead-reckoning. Recreating their
  // React roots every second causes visible flashes, while Mapbox can move a
  // marker without replacing its icon or label.
  useEffect(() => {
    const vesselMarkers = new globalThis.Map(
      markersRef.current
        .filter(({ vesselId }) => Boolean(vesselId))
        .map((renderedMarker) => [renderedMarker.vesselId, renderedMarker])
    );
    animatedVessels.filter(hasVesselLocation).forEach((vessel) => {
      vesselMarkers.get(vessel.id)?.marker.setLngLat({
        lng: vessel.location.longitude,
        lat: vessel.location.latitude,
      });
    });
  }, [animatedVessels]);

  // initialize map when mapRef is available
  useEffect(() => {
    // map ref guard
    if (isNull(mapRef.current)) {
      return;
    }
    const map = new Mapbox({
      accessToken: process.env.MAPBOX_ACCESS_TOKEN,
      container: mapRef.current,
      bounds: new LngLatBounds(
        { lat: DEFAULT_TOP, lon: DEFAULT_LEFT },
        { lat: DEFAULT_BOTTOM, lon: DEFAULT_RIGHT }
      ),
      style:
        theme === "dark"
          ? "mapbox://styles/ferryfyi/ckvzb5jy11hmj14o4imlemf5h"
          : "mapbox://styles/ferryfyi/ckvzbpoh21ggd14pdjorf1z5x",
    });
    map.addControl(new NavigationControl({ showCompass: false }));
    // publish loaded map
    const handleLoad = (): void => {
      setMap(map);
    };
    map.on("load", handleLoad);
    return () => {
      // cleanup map instance
      map.off("load", handleLoad);
      removeRenderedMarkers(markersRef.current);
      markersRef.current = [];
      map.remove();
    };
  }, [theme]);

  return (
    <>
      <Header
        share={
          (terminal &&
            mate && {
              shareButtonText: "Share Map",
              sharedText: `Map for ${terminal.name} to ${mate.name} ferry route`,
            }) ??
          undefined
        }
        items={[
          ...(terminal?.vesselWatchUrl
            ? [
                {
                  Icon: WSDOTIcon,
                  label: "WSF VesselWatch",
                  url: terminal.vesselWatchUrl,
                  isBottom: true,
                },
              ]
            : []),
        ]}
      >
        <div className="min-w-0 flex-1" />
        <div className="min-w-0 text-center">
          <RouteDropdown
            isOpen={isRouteOpen}
            options={routeOptions}
            selectedLabel={routeLabel}
            setOpen={setRouteOpen}
            onSelect={(event, option) => {
              event.preventDefault();
              setRouteOpen(false);
              setRoute(getSlug(option.terminal.id), getSlug(option.mate.id));
            }}
          />
        </div>
        <span className="ml-2 shrink-0">Map</span>
        <div className="min-w-0 flex-1" />
        <ReloadButton
          ariaLabel="Refresh boat data"
          className="ml-4"
          isReloading={isReloading}
          onClick={() => {
            reloadVessels().catch((error) => {
              // manual refresh failure
              console.error(error);
            });
          }}
        />
      </Header>
      <main
        ref={mapRef}
        className="map-container flex-grow bg-day-normal-light dark:bg-night-normal-dark"
      />
      {sourceUpdatedAt && (
        <div className="pointer-events-none fixed bottom-[calc(4rem+var(--safe-area-inset-bottom)+0.5rem)] left-0 right-0 z-20 flex justify-center">
          <FreshnessPill
            className="pointer-events-auto"
            isRefreshing={isReloading}
            onClick={() => {
              reloadVessels().catch(console.error);
            }}
            sourceUpdatedAt={sourceUpdatedAt}
          />
        </div>
      )}
      {refreshError ? (
        <Toast error>Could not refresh vessel data. Showing saved data.</Toast>
      ) : null}
    </>
  );
};
