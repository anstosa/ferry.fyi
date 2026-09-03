import "mapbox-gl/dist/mapbox-gl.css";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
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
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { useLocation, useNavigate } from "react-router-dom";
import type { Route } from "shared/contracts/routes";
import type { Schedule as ScheduleClass } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";

import { ExternalPillLink } from "~/components/ExternalPillLink";
import { FreshnessPill } from "~/components/FreshnessPill";
import { ReloadButton } from "~/components/ReloadButton";
import { Toast } from "~/components/Toast";
import { useGeo } from "~/lib/geo";
import { knotsToMph } from "~/lib/speed";
import { getPublicSsrSourceOutcome, usePublicSsrSnapshot } from "~/lib/ssrSeed";
import { getSlug, useTerminalList } from "~/lib/terminals";
import { useResolvedTheme } from "~/lib/theme";
import { selectVisibleVesselContent } from "~/lib/vesselAssignments";
import { getMapSailingPath, getNextVesselSailing } from "~/lib/vesselMapLinks";
import { getVesselSnapshot, refreshVessels } from "~/lib/vessels";
import { useWindowSize } from "~/lib/window";
import AnchorIcon from "~/static/images/icons/solid/anchor.svg";
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
const VESSEL_MARKER_HEIGHT = 36;
const MAP_LABEL_HEIGHT = 26;

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function normalizeMapQuery(search: string): string {
  const query = new URLSearchParams();
  [...new URLSearchParams(search)]
    .filter(([key]) => key === "date")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey)
    )
    .forEach(([key, value]) => query.append(key, value));
  return query.toString();
}

function snapshotTimestamp(
  source:
    | {
        observedAt: string;
        sourceUpdatedAt: string | null;
      }
    | undefined
): number | null {
  if (!source) {
    return null;
  }
  const timestamp = Date.parse(source.sourceUpdatedAt ?? source.observedAt);
  return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}

interface Props {
  mate: Terminal | null;
  requestIdentity: string;
  schedule: ScheduleClass | null;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal | null;
  time: DateTime;
  vesselIdentity: string;
  vessels: Vessel[];
}

interface MarkerLabelProps {
  ariaLabel?: string;
  icon: ReactElement;
  iconClassName: string;
  isSelected?: boolean;
  label: string | null;
  labelClassName?: string;
  labelPlacement: string;
  onClick?: () => void;
}

interface VesselMarkerIconProps {
  heading: number;
  isAtDock: boolean;
  isSelected: boolean;
  speed: number;
}

interface VesselMarkerStyle extends CSSProperties {
  "--vessel-wind-duration": string;
  "--vessel-wind-length": string;
  "--vessel-wind-opacity": string;
}

interface VesselDetailsCardProps {
  arrivingTerminal: Terminal | null;
  cardRef: React.RefObject<HTMLElement | null>;
  departingTerminal: Terminal | null;
  nextSailingPath: string | null;
  nextSailingTime: number | null;
  onClose: () => void;
  time: DateTime;
  vessel: Vessel;
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
type LocatedTerminal = Terminal & {
  location: NonNullable<Terminal["location"]>;
};
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

// visible map focus offset
const getVesselFocusOffset = (
  mapElement: HTMLElement,
  cardElement: HTMLElement | null
): [number, number] => {
  // missing card guard
  if (!cardElement) {
    return [0, 0];
  }
  const mapRect = mapElement.getBoundingClientRect();
  const cardRect = cardElement.getBoundingClientRect();
  // non-overlapping card guard
  if (cardRect.top >= mapRect.bottom || cardRect.bottom <= mapRect.top) {
    return [0, 0];
  }
  const visibleBottom = Math.max(
    mapRect.top,
    Math.min(mapRect.bottom, cardRect.top)
  );
  const visibleCenter = (mapRect.top + visibleBottom) / 2;
  const mapCenter = (mapRect.top + mapRect.bottom) / 2;
  return [0, visibleCenter - mapCenter];
};

// optional vessel time label
const formatVesselTime = (timestamp?: number): string | null => {
  // missing timestamp guard
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }
  return DateTime.fromSeconds(timestamp).toFormat("h:mm a");
};

// relative vessel eta label
const formatEstimatedArrivalMinutes = (
  timestamp: number | undefined,
  time: DateTime
): string | null => {
  // missing timestamp guard
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }
  const minutes = Math.max(
    0,
    Math.round(DateTime.fromSeconds(timestamp).diff(time).as("minutes"))
  );
  return `${minutes} mins`;
};

// selected vessel details
const VesselDetailsCard = ({
  arrivingTerminal,
  cardRef,
  departingTerminal,
  nextSailingPath,
  nextSailingTime,
  onClose,
  time,
  vessel,
}: VesselDetailsCardProps): ReactElement => {
  const speedMph = Math.round(knotsToMph(vessel.speed));
  const etaLabel = vessel.isAtDock
    ? null
    : formatEstimatedArrivalMinutes(vessel.estimatedArrivalTime, time);
  const nextSailingLabel = formatVesselTime(nextSailingTime ?? undefined);
  let sailingLabel = vessel.info?.crossing ?? "Route unavailable";
  // destination-only sailing
  if (arrivingTerminal) {
    sailingLabel = `To ${arrivingTerminal.name}`;
  }
  // complete sailing route
  if (departingTerminal && arrivingTerminal) {
    sailingLabel = `${departingTerminal.name} → ${arrivingTerminal.name}`;
  }
  return (
    <aside
      aria-label={`${vessel.name} details`}
      className={clsx(
        "fixed bottom-[calc(4rem+var(--safe-area-inset-bottom)+0.75rem)] left-3 right-3 z-30",
        "mx-auto max-w-md overflow-hidden rounded-2xl border shadow-2xl",
        "border-gray-medium bg-white text-gray-darkest",
        "dark:border-gray-dark dark:bg-gray-darkest dark:text-white"
      )}
      ref={cardRef}
      role="region"
    >
      <header
        className={clsx(
          "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4",
          "bg-gradient-to-br from-blue-lightest via-white to-green-lightest",
          "dark:from-blue-darkest dark:via-gray-darkest dark:to-green-dark"
        )}
      >
        <div className="min-w-0">
          <p className="text-2xs font-black uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Live vessel
          </p>
          <h2 className="mt-1 text-xl font-black leading-tight">
            {vessel.name}
          </h2>
          <p className="mt-1 text-sm font-semibold text-gray-dark dark:text-gray-light">
            {sailingLabel}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            aria-label={`Close ${vessel.name} details`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-xl font-bold transition hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
          {/* wsf vessel page link */}
          {vessel.vesselWatchUrl && (
            <ExternalPillLink
              className="shrink-0 whitespace-nowrap"
              href={vessel.vesselWatchUrl}
            >
              WSF vessel page
            </ExternalPillLink>
          )}
        </div>
      </header>
      <dl className="grid grid-cols-3 gap-2 p-4 text-center">
        <div className="rounded-lg bg-darken-lowest p-2 dark:bg-white/10">
          <dt className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Status
          </dt>
          <dd className="mt-1 text-sm font-black">
            {vessel.isAtDock ? "Docked" : "Underway"}
          </dd>
        </div>
        <div className="rounded-lg bg-darken-lowest p-2 dark:bg-white/10">
          <dt className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Speed
          </dt>
          <dd className="mt-1 text-sm font-black">{speedMph} mph</dd>
        </div>
        <div className="rounded-lg bg-darken-lowest p-2 dark:bg-white/10">
          <dt className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            {etaLabel ? "ETA" : "Destination"}
          </dt>
          <dd className="mt-1 truncate text-sm font-black">
            {etaLabel ?? arrivingTerminal?.name ?? "Unknown"}
          </dd>
        </div>
      </dl>
      <div className="grid gap-2 px-4 pb-4">
        {/* next sailing link */}
        {nextSailingPath && (
          <a
            className="w-full rounded-lg bg-green-dark px-3 py-2.5 text-center text-sm font-bold text-white shadow-sm transition hover:bg-green-medium dark:bg-green-light dark:text-green-dark"
            href={nextSailingPath}
          >
            Next sailing{nextSailingLabel ? ` · ${nextSailingLabel}` : ""}
          </a>
        )}
      </div>
    </aside>
  );
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
  ariaLabel,
  icon,
  iconClassName,
  isSelected = false,
  label,
  labelClassName,
  labelPlacement,
  onClick,
}: MarkerLabelProps): ReactElement => {
  const content = (
    <>
      <div className={iconClassName}>{icon}</div>
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
    </>
  );
  // interactive marker guard
  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className="relative flex items-center justify-center border-0 bg-transparent p-0 text-inherit pointer-events-auto"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="relative flex items-center justify-center pointer-events-auto">
      {content}
    </div>
  );
};

// speed-scaled vessel motion style
const getVesselMarkerStyle = (
  heading: number,
  speed: number
): VesselMarkerStyle => {
  const speedRatio = Math.min(Math.max(speed, 0) / 20, 1);
  return {
    "--vessel-wind-duration": `${(1.8 - speedRatio * 0.9).toFixed(2)}s`,
    "--vessel-wind-length": `${Math.round(6 + speedRatio * 14)}px`,
    "--vessel-wind-opacity": (0.18 + speedRatio * 0.32).toFixed(2),
    transform: `rotate(${heading}deg)`,
  };
};

// vessel status marker
const VesselMarkerIcon = ({
  heading,
  isAtDock,
  isSelected,
  speed,
}: VesselMarkerIconProps): ReactElement => {
  const isMoving = !isAtDock && speed > 0;
  return (
    <span
      className="vessel-marker-visual"
      data-vessel-motion={isMoving ? "moving" : "still"}
      data-vessel-selected={isSelected ? "true" : "false"}
      style={getVesselMarkerStyle(heading, speed)}
    >
      {/* moving wind */}
      {isMoving && (
        <span aria-hidden="true" className="vessel-marker-wind">
          <span className="vessel-marker-wind-streak" />
          <span className="vessel-marker-wind-streak" />
          <span className="vessel-marker-wind-streak" />
        </span>
      )}
      <span
        className={clsx(
          "vessel-marker-icon",
          isSelected && "vessel-marker-icon--selected"
        )}
      >
        <VesselIcon />
      </span>
      {/* docked anchor */}
      {isAtDock && (
        <span
          aria-hidden="true"
          className="vessel-marker-anchor"
          data-vessel-anchor="true"
        >
          <span style={{ transform: `rotate(${-heading}deg)` }}>
            <AnchorIcon />
          </span>
        </span>
      )}
    </span>
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

// located terminal check
const hasTerminalLocation = (
  terminal: Terminal | null | undefined
): terminal is LocatedTerminal =>
  Boolean(
    terminal?.location &&
    Number.isFinite(terminal.location.latitude) &&
    Number.isFinite(terminal.location.longitude)
  );

// persistent vessel name
const getVesselLabel = (vessel: Vessel): string => vessel.name;

export const Map = ({
  mate,
  requestIdentity,
  schedule,
  setRoute,
  terminal,
  time,
  vesselIdentity,
  vessels,
}: Props): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  // focused vessel query
  const requestedVesselId = useMemo(
    () => new URLSearchParams(location.search).get("vessel"),
    [location.search]
  );
  const snapshot = usePublicSsrSnapshot();
  const terminalSlug = terminal ? getSlug(terminal.id) : undefined;
  const mateSlug = mate ? getSlug(mate.id) : undefined;
  const seededRoutePath = terminalSlug
    ? `/${terminalSlug}${
        snapshot?.routeParams.mateSlug
          ? `/${snapshot.routeParams.mateSlug}`
          : ""
      }/map`
    : undefined;
  const hasMatchingSeedRoute =
    terminalSlug !== undefined &&
    snapshot !== undefined &&
    normalizePath(location.pathname) === seededRoutePath &&
    snapshot.routeParams.terminalSlug === terminalSlug &&
    (!snapshot.routeParams.mateSlug ||
      snapshot.routeParams.mateSlug === mateSlug) &&
    normalizeMapQuery(location.search) ===
      normalizeMapQuery(
        new URLSearchParams(snapshot.normalizedUrl.query).toString()
      ) &&
    snapshot.routeId ===
      (snapshot.routeParams.mateSlug ? "mate-map" : "terminal-map");
  const seededVesselsOutcome = hasMatchingSeedRoute
    ? getPublicSsrSourceOutcome(snapshot, "vessels")
    : undefined;
  const seededVessels = useMemo(
    () =>
      seededVesselsOutcome?.outcome === "value" ||
      seededVesselsOutcome?.outcome === "empty" ||
      seededVesselsOutcome?.outcome === "stale-usable"
        ? ([...seededVesselsOutcome.value] as Vessel[])
        : undefined,
    [seededVesselsOutcome]
  );
  const routeKey = requestIdentity;
  const hasLiveVesselAssignments = vesselIdentity !== "";
  const initialVessels = hasLiveVesselAssignments
    ? vessels
    : (seededVessels ?? []);
  const seededSourceUpdatedAt = snapshotTimestamp(seededVesselsOutcome);
  const mapRef = useRef<HTMLDivElement>(null);
  const vesselCardRef = useRef<HTMLElement>(null);
  const activeMapRef = useRef<Mapbox | null>(null);
  const markersRef = useRef<RenderedMarker[]>([]);
  const lastFittedVesselsRef = useRef<Vessel[] | null>(null);
  const lastFocusedVesselRef = useRef<{
    latitude: number;
    longitude: number;
    map: Mapbox;
    routeKey: string;
    vesselId: string;
  } | null>(null);
  const routeVesselIdsRef = useRef(new Set(initialVessels.map(({ id }) => id)));
  routeVesselIdsRef.current = new Set(
    (hasLiveVesselAssignments ? vessels : (seededVessels ?? [])).map(
      ({ id }) => id
    )
  );
  const activeRouteKeyRef = useRef(routeKey);
  activeRouteKeyRef.current = routeKey;
  const activeVesselIdentityRef = useRef(vesselIdentity);
  activeVesselIdentityRef.current = vesselIdentity;
  const vesselRefreshRef = useRef<Promise<void> | null>(null);
  const [vesselState, setVesselState] = useState(() => ({
    routeKey,
    sourceUpdatedAt: hasLiveVesselAssignments ? null : seededSourceUpdatedAt,
    vesselIdentity,
    vessels: initialVessels,
  }));
  const { sourceUpdatedAt, vessels: displayedVessels } =
    selectVisibleVesselContent({
      current: vesselState,
      routeKey,
      seededSourceUpdatedAt,
      seededVessels: seededVessels ?? [],
      vesselIdentity,
      vessels,
    });
  const [animatedVessels, setAnimatedVessels] = useState(initialVessels);
  const [isReloading, setReloading] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const theme = useResolvedTheme();
  const [userLocation] = useGeo();
  const terminals = useTerminalList();
  const activeRoute = getActiveRoute(terminal, mate);
  const routeOptions = getRouteOptions(terminals, activeRoute?.id);
  const routeLabel =
    activeRoute?.description ??
    (terminal && mate ? `${terminal.name} / ${mate.name}` : "Route");
  // selected vessel lookup
  const selectedVessel = useMemo(
    () =>
      displayedVessels.find(({ id }) => {
        // selected id match
        return id === requestedVesselId;
      }) ?? null,
    [displayedVessels, requestedVesselId]
  );
  const knownTerminals = [terminal, mate, ...terminals].filter(
    (item): item is Terminal => {
      // loaded terminal guard
      return Boolean(item);
    }
  );
  const departingTerminal = selectedVessel?.departingTerminalId
    ? (knownTerminals.find(({ id }) => {
        // departing terminal match
        return id === String(selectedVessel.departingTerminalId);
      }) ?? null)
    : null;
  const arrivingTerminal = selectedVessel?.arrivingTerminalId
    ? (knownTerminals.find(({ id }) => {
        // arriving terminal match
        return id === String(selectedVessel.arrivingTerminalId);
      }) ?? null)
    : null;
  const nextSailing = selectedVessel
    ? getNextVesselSailing(schedule, selectedVessel.id, time.toSeconds())
    : null;
  const nextSailingPath =
    schedule && nextSailing
      ? getMapSailingPath({
          mapPathname: location.pathname,
          sailing: nextSailing,
          schedule,
          tab: "vessel",
        })
      : null;

  // permalink vessel selection
  const selectVessel = (vesselId: string | null): void => {
    const query = new URLSearchParams(location.search);
    // selected vessel query
    if (vesselId) {
      query.set("vessel", vesselId);
    } else {
      query.delete("vessel");
    }
    const search = query.toString();
    navigate({
      pathname: location.pathname,
      search: search ? `?${search}` : "",
    });
  };

  useEffect(() => {
    const nextVessels = hasLiveVesselAssignments
      ? vessels
      : (seededVessels ?? []);
    routeVesselIdsRef.current = new Set(nextVessels.map(({ id }) => id));
    setVesselState((current) => {
      const hasSameLiveAssignments =
        hasLiveVesselAssignments &&
        current.routeKey === routeKey &&
        current.vesselIdentity === vesselIdentity;
      let nextSourceUpdatedAt = seededSourceUpdatedAt;
      if (hasLiveVesselAssignments) {
        nextSourceUpdatedAt = hasSameLiveAssignments
          ? current.sourceUpdatedAt
          : null;
      }
      return {
        routeKey,
        sourceUpdatedAt: nextSourceUpdatedAt,
        vesselIdentity,
        vessels: hasSameLiveAssignments ? current.vessels : nextVessels,
      };
    });
  }, [
    hasLiveVesselAssignments,
    routeKey,
    seededSourceUpdatedAt,
    seededVessels,
    vesselIdentity,
    vessels,
  ]);
  // Confirmed API positions replace any client-side prediction.
  useEffect(() => setAnimatedVessels(displayedVessels), [displayedVessels]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setAnimatedVessels((current) => current.map(advanceVesselPosition));
    }, VESSEL_ANIMATION_MS);
    return () => window.clearInterval(interval);
  }, []);

  const loadVessels = (
    loadSnapshot: () => ReturnType<typeof getVesselSnapshot>
  ): Promise<void> => {
    if (vesselRefreshRef.current) {
      return vesselRefreshRef.current;
    }
    const requestRouteKey = activeRouteKeyRef.current;
    setReloading(true);
    setRefreshError(false);
    const refresh = (async (): Promise<void> => {
      try {
        const refreshed = await loadSnapshot();
        if (activeRouteKeyRef.current !== requestRouteKey) {
          return;
        }
        const currentVesselIdentity = activeVesselIdentityRef.current;
        const currentVesselIds = new Set(routeVesselIdsRef.current);
        const currentHasLiveAssignments = currentVesselIdentity !== "";
        setVesselState((current) => {
          if (
            current.routeKey !== requestRouteKey ||
            current.vesselIdentity !== currentVesselIdentity
          ) {
            return current;
          }
          if (currentVesselIds.size === 0) {
            if (!currentHasLiveAssignments) {
              return current;
            }
            return {
              routeKey: requestRouteKey,
              sourceUpdatedAt: refreshed.sourceUpdatedAt,
              vesselIdentity: currentVesselIdentity,
              vessels: [],
            };
          }
          const matchingVessels = refreshed.vessels.filter(({ id }) =>
            currentVesselIds.has(id)
          );
          if (matchingVessels.length === 0) {
            return current;
          }
          return {
            routeKey: requestRouteKey,
            sourceUpdatedAt: refreshed.sourceUpdatedAt,
            vesselIdentity: currentVesselIdentity,
            vessels: matchingVessels,
          };
        });
      } catch (error) {
        if (activeRouteKeyRef.current === requestRouteKey) {
          setRefreshError(true);
        }
        throw error;
      } finally {
        if (activeRouteKeyRef.current === requestRouteKey) {
          setReloading(false);
        }
      }
    })();
    vesselRefreshRef.current = refresh;
    const clearRefresh = (): void => {
      if (vesselRefreshRef.current === refresh) {
        vesselRefreshRef.current = null;
      }
    };
    refresh.then(clearRefresh, clearRefresh);
    return refresh;
  };
  const pollVessels = (): Promise<void> =>
    loadVessels(() =>
      getVesselSnapshot({ maxAgeMs: VESSEL_REFRESH_MS - 5000 })
    );
  const forceRefreshVessels = (): Promise<void> => loadVessels(refreshVessels);

  useEffect(() => {
    const refreshVisibleVessels = (): void => {
      if (document.visibilityState === "visible") {
        pollVessels().catch(console.error);
      }
    };
    refreshVisibleVessels();
    const interval = window.setInterval(() => {
      refreshVisibleVessels();
    }, VESSEL_REFRESH_MS);
    const handleVisibilityChange = (): void => {
      refreshVisibleVessels();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [routeKey]);

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
    if (
      !map ||
      map !== activeMapRef.current ||
      !hasTerminalLocation(terminal) ||
      !hasTerminalLocation(mate)
    ) {
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
    const locatedTerminals = [terminal, ...(terminal.mates || [])].filter(
      hasTerminalLocation
    );
    newMarkers.push(
      ...locatedTerminals.map((targetTerminal) => {
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
        // exclude the overflowing label from marker anchoring
        marker.style.height = `${VESSEL_MARKER_HEIGHT}px`;
        marker.style.width = `${MAP_MARKER_SIZE}px`;
        const isSelected = vessel.id === requestedVesselId;
        const heading = (vessel.heading ?? 0) - 45;
        const lngLat = {
          lon: vessel.location.longitude,
          lat: vessel.location.latitude,
        };
        const label = getVesselLabel(vessel);
        const point = map.project([lngLat.lon, lngLat.lat]);
        const placement =
          getVesselLabelPlacement(
            point.x,
            point.y,
            label,
            occupied,
            mapSize.width,
            mapSize.height
          ) ?? "above";
        maybeUpdateBounds(lngLat);
        const root = renderMarkerIcon(
          renderMarkerLabel({
            ariaLabel: `Open ${vessel.name} vessel details`,
            icon: (
              <VesselMarkerIcon
                heading={heading}
                isAtDock={vessel.isAtDock === true}
                isSelected={isSelected}
                speed={vessel.speed}
              />
            ),
            iconClassName: clsx(
              "text-3xl drop-shadow",
              vessel.isAtDock
                ? "text-gray-dark dark:text-gray-light"
                : "text-countdown"
            ),
            isSelected,
            label,
            labelClassName: clsx(
              "rounded-full text-white",
              isSelected
                ? "border-blue-dark bg-blue-dark dark:border-blue-light dark:bg-blue-light dark:text-blue-darkest"
                : "border-countdown bg-countdown"
            ),
            labelPlacement: LABEL_PLACEMENTS[placement],
            onClick: () => {
              // permalink vessel marker
              selectVessel(vessel.id);
            },
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

    // fit the route without a located vessel focus
    if (
      !selectedVessel?.location &&
      lastFittedVesselsRef.current !== displayedVessels
    ) {
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
    requestedVesselId,
    userLocation,
  ]);

  // follow the selected vessel position
  useEffect(() => {
    // clear closed vessel focus
    if (!requestedVesselId) {
      lastFocusedVesselRef.current = null;
      return;
    }
    // map readiness guard
    if (!map) {
      return;
    }
    const focusedVessel = animatedVessels.find(({ id }) => {
      // focused id match
      return id === requestedVesselId;
    });
    // vessel location guard
    if (!focusedVessel?.location) {
      return;
    }
    const previousFocus = lastFocusedVesselRef.current;
    // distinguish initial focus from following
    const isContinuingFocus =
      previousFocus?.map === map &&
      previousFocus.routeKey === routeKey &&
      previousFocus.vesselId === requestedVesselId;
    // duplicate focus guard
    if (
      isContinuingFocus &&
      previousFocus.latitude === focusedVessel.location.latitude &&
      previousFocus.longitude === focusedVessel.location.longitude
    ) {
      return;
    }
    const center: [number, number] = [
      focusedVessel.location.longitude,
      focusedVessel.location.latitude,
    ];
    // shared camera destination
    const focus = {
      center,
      duration: 800,
      offset: getVesselFocusOffset(map.getContainer(), vesselCardRef.current),
    };
    // preserve user zoom while following
    if (isContinuingFocus) {
      map.easeTo(focus);
    } else {
      map.easeTo({ ...focus, zoom: 12 });
    }
    lastFocusedVesselRef.current = {
      latitude: focusedVessel.location.latitude,
      longitude: focusedVessel.location.longitude,
      map,
      routeKey,
      vesselId: requestedVesselId,
    };
  }, [animatedVessels, map, requestedVesselId, routeKey]);

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
    activeMapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }));
    // publish loaded map
    const handleLoad = (): void => {
      if (activeMapRef.current === map) {
        setMap(map);
      }
    };
    map.on("load", handleLoad);
    return () => {
      // cleanup map instance
      map.off("load", handleLoad);
      if (activeMapRef.current === map) {
        activeMapRef.current = null;
      }
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
            forceRefreshVessels().catch((error) => {
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
      {/* selected vessel card */}
      {selectedVessel && (
        <VesselDetailsCard
          arrivingTerminal={arrivingTerminal}
          cardRef={vesselCardRef}
          departingTerminal={departingTerminal}
          nextSailingPath={nextSailingPath}
          nextSailingTime={nextSailing?.time ?? null}
          onClose={() => {
            // clear vessel permalink
            selectVessel(null);
          }}
          time={time}
          vessel={selectedVessel}
        />
      )}
      {sourceUpdatedAt && !selectedVessel && (
        <div
          className="pointer-events-none fixed bottom-[calc(4rem+var(--safe-area-inset-bottom)+0.5rem)] left-0 right-0 z-20 flex justify-center"
          data-live-freshness="vessels"
          data-source-updated-at={sourceUpdatedAt}
        >
          <FreshnessPill
            className="pointer-events-auto"
            isRefreshing={isReloading}
            onClick={() => {
              forceRefreshVessels().catch(console.error);
            }}
            sourceUpdatedAt={sourceUpdatedAt}
          />
        </div>
      )}
      {refreshError ? (
        <Toast footerDocked error>
          Could not refresh vessel data. Showing saved data.
        </Toast>
      ) : null}
    </>
  );
};
