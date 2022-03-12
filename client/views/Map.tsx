import { Header } from "./Header";
import { isDark } from "~/lib/theme";
import { isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import {
  LngLatBounds,
  Map as Mapbox,
  Marker,
  NavigationControl,
  Popup,
} from "mapbox-gl";
import { render } from "react-dom";
import { renderToString } from "react-dom/server";
import { Vessel } from "shared/contracts/vessels";
import CurrentTerminalIcon from "~/static/images/icons/solid/location.svg";
import MateTerminalIcon from "~/static/images/icons/solid/map-marker.svg";
import OtherTerminalIcon from "~/static/images/icons/regular/map-marker-alt.svg";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import VesselIcon from "~/static/images/icons/solid/location-arrow.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import type { Terminal } from "shared/contracts/terminals";

const DEFAULT_TOP = 47;
const DEFAULT_LEFT = -121;
const DEFAULT_BOTTOM = 49;
const DEFAULT_RIGHT = -123;

interface Props {
  terminal: Terminal | null;
  mate: Terminal | null;
  vessels: Vessel[];
}

export const Map = ({ terminal, mate, vessels }: Props): ReactElement => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);

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
      if (lat > top) {
        top = lat;
      }
      if (lon < left) {
        left = lon;
      }
      if (lat < bottom) {
        bottom = lat;
      }
      if (lon > right) {
        right = lon;
      }
    };

    const newMarkers: Marker[] = [];

    if (!map || !terminal || !mate) {
      return;
    }

    // remove existing markers
    if (!isEmpty(markers)) {
      markers.forEach((marker) => marker.remove());
    }
    // add terminal markers
    newMarkers.concat(
      [terminal, ...(terminal.mates || [])].map((t: Terminal) => {
        const marker = document.createElement("div");
        marker.className = "text-3xl text-white";
        let icon = <OtherTerminalIcon />;
        if (t === terminal) {
          icon = <CurrentTerminalIcon />;
        } else if (t === mate) {
          icon = <MateTerminalIcon />;
        }
        render(icon, marker);
        const lngLat = {
          lon: t.location.longitude,
          lat: t.location.latitude,
        };
        maybeUpdateBounds(lngLat);
        return new Marker({ anchor: "bottom", element: marker })
          .setLngLat(lngLat)
          .setPopup(
            new Popup({
              offset: t === terminal ? 0 : 25,
              closeButton: false,
            }).setHTML(
              renderToString(
                <>
                  <div className="text-black">{t.name}</div>
                </>
              )
            )
          )
          .addTo(map);
      })
    );

    // add vessel markers
    newMarkers.concat(
      vessels
        .filter(({ location }) => Boolean(location))
        .map((vessel: Vessel) => {
          const marker = document.createElement("div");
          marker.className = "text-3xl text-green-dark";
          render(<VesselIcon />, marker);
          const lngLat = {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            lon: vessel.location!.longitude,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            lat: vessel.location!.latitude,
          };
          maybeUpdateBounds(lngLat);
          return new Marker({
            element: marker,
            rotation: (vessel.heading || 0) - 45,
          })
            .setLngLat(lngLat)
            .setPopup(
              new Popup({ offset: 25, closeButton: false }).setHTML(
                renderToString(
                  <>
                    <div className="text-black">{vessel.name}</div>
                  </>
                )
              )
            )
            .addTo(map);
        })
    );

    setMarkers(newMarkers);

    // fit map to markers
    map.fitBounds(
      new LngLatBounds({ lat: bottom, lon: left }, { lat: top, lon: right }),
      { padding: 40 }
    );
  };

  // update markers when anything changes
  useEffect(updateMarkers, [map, vessels, terminal, mate]);

  // initialize map when mapRef is available
  useEffect(() => {
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
      <main ref={mapRef} className="map-container flex-grow" />
    </>
  );
};
