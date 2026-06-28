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

import { useGeo } from "~/lib/geo";
import { knotsToMph } from "~/lib/speed";
import { getSlug, useTerminals } from "~/lib/terminals";
import { isDark } from "~/lib/theme";
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
const LABEL_PLACEMENTS = [
  "top-full left-1/2 mt-1 -translate-x-1/2",
  "bottom-full left-1/2 mb-1 -translate-x-1/2",
  "left-full top-1/2 ml-2 -translate-y-1/2",
  "right-full top-1/2 mr-2 -translate-y-1/2",
];

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
  label: string;
  labelPlacement: string;
}

interface RenderedMarker {
  marker: Marker;
  root: ReturnType<typeof createRoot>;
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

// stagger labels
const getLabelPlacement = (index: number): string =>
  LABEL_PLACEMENTS[index % LABEL_PLACEMENTS.length];

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
  labelPlacement,
}: MarkerLabelProps): ReactElement => {
  return (
    <div className="relative flex items-center justify-center pointer-events-auto">
      <div className={iconClassName} style={iconStyle}>
        {icon}
      </div>
      <div
        className={[
          "absolute z-10 px-2 py-1 rounded-full border shadow",
          "border-[rgba(1,111,82,0.18)] bg-day-normal-light text-gray-dark",
          "dark:border-[rgba(255,255,255,0.08)] dark:bg-night-normal-dark dark:text-[#e0f0f4]",
          "text-xs font-bold whitespace-nowrap transform",
          labelPlacement,
        ].join(" ")}
      >
        {label}
      </div>
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
    marker.remove();
    window.setTimeout(() => {
      // defer react cleanup
      root.unmount();
    }, 0);
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
  const [map, setMap] = useState<Mapbox | null>(null);
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const [userLocation] = useGeo();
  const { terminals } = useTerminals();
  const activeRoute = getActiveRoute(terminal, mate);
  const routeOptions = getRouteOptions(terminals, activeRoute?.id);
  const routeLabel =
    activeRoute?.description ??
    (terminal && mate ? `${terminal.name} / ${mate.name}` : "Route");

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

    // remove existing markers
    if (!isEmpty(markersRef.current)) {
      removeRenderedMarkers(markersRef.current);
      markersRef.current = [];
    }

    // map readiness guard
    if (!map || !terminal || !mate) {
      return;
    }

    // add terminal markers
    newMarkers.push(
      ...[terminal, ...(terminal.mates || [])].map((targetTerminal, index) => {
        const marker = document.createElement("div");
        const lngLat = {
          lon: targetTerminal.location.longitude,
          lat: targetTerminal.location.latitude,
        };
        maybeUpdateBounds(lngLat);
        const root = renderMarkerIcon(
          renderMarkerLabel({
            icon: <MapPinIcon />,
            iconClassName: "text-3xl text-green-dark drop-shadow",
            label: targetTerminal.name,
            labelPlacement: getLabelPlacement(index),
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
      ...vessels.filter(hasVesselLocation).map((vessel, index) => {
        const marker = document.createElement("div");
        const heading = (vessel.heading ?? 0) - 45;
        const lngLat = {
          lon: vessel.location.longitude,
          lat: vessel.location.latitude,
        };
        maybeUpdateBounds(lngLat);
        const root = renderMarkerIcon(
          renderMarkerLabel({
            icon: <VesselIcon />,
            iconClassName: "text-3xl text-countdown drop-shadow",
            iconStyle: { transform: `rotate(${heading}deg)` },
            label: getVesselLabel(vessel),
            labelPlacement: getLabelPlacement(index + 1),
          }),
          marker
        );
        return {
          marker: new Marker({ anchor: "center", element: marker })
            .setLngLat(lngLat)
            .addTo(map),
          root,
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
          labelPlacement: getLabelPlacement(newMarkers.length),
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
    map.fitBounds(
      new LngLatBounds({ lat: bottom, lon: left }, { lat: top, lon: right }),
      { padding: 40 }
    );
  };

  // update markers when anything changes
  useEffect(updateMarkers, [map, vessels, terminal, mate, userLocation]);

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
      style: isDark
        ? "mapbox://styles/ferryfyi/ckvzb5jy11hmj14o4imlemf5h"
        : "mapbox://styles/ferryfyi/ckvzbpoh21ggd14pdjorf1z5x",
    });
    setMap(map);
    map.addControl(new NavigationControl({ showCompass: false }));
    map.on("load", updateMarkers);
    return () => {
      // cleanup map instance
      map.off("load", updateMarkers);
      removeRenderedMarkers(markersRef.current);
      markersRef.current = [];
      map.remove();
    };
  }, [mapRef]);

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
        <div className="ml-4 h-6 w-6" />
      </Header>
      <main
        ref={mapRef}
        className="map-container flex-grow bg-day-normal-light dark:bg-night-normal-dark"
      />
    </>
  );
};
