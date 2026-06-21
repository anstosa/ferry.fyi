import {
  LngLatBounds,
  Map as Mapbox,
  Marker,
  NavigationControl,
} from "mapbox-gl";
import React, {
  CSSProperties,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";

import { useGeo } from "~/lib/geo";
import { knotsToMph } from "~/lib/speed";
import { isDark } from "~/lib/theme";
import UserLocationIcon from "~/static/images/icons/solid/dot-circle.svg";
import VesselIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapPinIcon from "~/static/images/icons/solid/map-pin.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { Header } from "./Header";

const DEFAULT_TOP = 47;
const DEFAULT_LEFT = -121;
const DEFAULT_BOTTOM = 49;
const DEFAULT_RIGHT = -123;
const LABEL_PLACEMENTS = [
  "top-full left-1/2 mt-1 -translate-x-1/2",
  "bottom-full left-1/2 mb-1 -translate-x-1/2",
  "left-full top-1/2 ml-2 -translate-y-1/2",
  "right-full top-1/2 mr-2 -translate-y-1/2",
];

interface Props {
  terminal: Terminal | null;
  mate: Terminal | null;
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

type LocatedVessel = Vessel & { location: NonNullable<Vessel["location"]> };

// stagger labels
const getLabelPlacement = (index: number): string =>
  LABEL_PLACEMENTS[index % LABEL_PLACEMENTS.length];

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
          "absolute z-10 px-2 py-1 rounded-full shadow",
          "bg-white text-gray-900 dark:bg-gray-darkest dark:text-white",
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

export const Map = ({ terminal, mate, vessels }: Props): ReactElement => {
  const mapRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<RenderedMarker[]>([]);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [userLocation] = useGeo();

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
            iconClassName: "text-3xl text-white drop-shadow",
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
            iconClassName: "text-3xl text-green-dark drop-shadow",
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
          iconClassName: "text-2xl text-blue-medium drop-shadow",
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
        <span className="text-center flex-1">
          {terminal && mate && `${terminal.name} to ${mate.name}`} Map
        </span>
        <div className="h-6 w-6 ml-4" />
      </Header>
      <main
        ref={mapRef}
        className="map-container flex-grow bg-white dark:bg-black"
      />
    </>
  );
};
