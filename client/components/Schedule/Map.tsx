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
import CurrentTerminalIcon from "~/images/icons/solid/map-marker.svg";
import MateTerminalIcon from "~/images/icons/solid/map-marker-alt.svg";
import OtherTerminalIcon from "~/images/icons/regular/map-marker-alt.svg";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import VesselIcon from "~/images/icons/solid/location-arrow.svg";
import type { Terminal } from "shared/contracts/terminals";

interface Props {
  terminal: Terminal;
  mate: Terminal;
  vessels: Vessel[];
}

export const Map = ({ terminal, mate, vessels }: Props): ReactElement => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Mapbox | null>(null);
  const [top, setTop] = useState<number>(47);
  const [left, setLeft] = useState<number>(-121);
  const [bottom, setBottom] = useState<number>(49);
  const [right, setRight] = useState<number>(-123);
  const [markers, setMarkers] = useState<Marker[]>([]);

  const maybeUpdateBounds = ({
    lon,
    lat,
  }: {
    lon: number;
    lat: number;
  }): void => {
    if (lat > top) {
      setTop(lat);
    }
    if (lon < left) {
      setLeft(lon);
    }
    if (lat < bottom) {
      setBottom(lat);
    }
    if (lon > right) {
      setRight(lon);
    }
  };

  // update map zoom when points change
  useEffect(() => {
    if (map) {
      map.fitBounds(
        new LngLatBounds({ lat: top, lon: left }, { lat: bottom, lon: right }),
        { padding: 25 }
      );
    }
  }, [map, top, left, bottom, right]);

  const updateMarkers = (): void => {
    const newMarkers: Marker[] = [];
    if (!map) {
      return;
    }
    if (!isEmpty(markers)) {
      markers.forEach((marker) => marker.remove());
    }
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
            new Popup({ offset: 25, closeButton: false }).setHTML(
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
  };

  useEffect(updateMarkers, [map, vessels, terminal, mate]);

  useEffect(() => {
    if (isNull(mapRef.current)) {
      return;
    }
    const map = new Mapbox({
      accessToken: process.env.MAPBOX_ACCESS_TOKEN,
      container: mapRef.current,
      bounds: new LngLatBounds(
        { lat: top, lon: left },
        { lat: bottom, lon: right }
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
      <div ref={mapRef} className="map-container flex-grow" />
    </>
  );
};
