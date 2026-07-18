import { Geolocation } from "@capacitor/geolocation";
import { useEffect, useState } from "react";
import { isUndefined } from "shared/lib/identity";

import { useLocalStorage } from "./browser";

export interface Point {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS = 3956;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
let locationRequest: Promise<Point | null> | undefined;

// Gets distance between two points in miles using Haversine formula
export const getDistance = (a: Point, b: Point): number => {
  const deltaLongitude = toRadians(b.longitude) - toRadians(a.longitude);
  const deltaLatitude = toRadians(b.latitude) - toRadians(a.latitude);

  const x =
    Math.pow(Math.sin(deltaLatitude / 2), 2) +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.pow(Math.sin(deltaLongitude / 2), 2);

  const c = 2 * Math.asin(Math.sqrt(x));

  return c * EARTH_RADIUS;
};

const fetchCurrentLocation = async (): Promise<Point | null> => {
  try {
    // The native plugin owns the Android permission callback for this lookup.
    const {
      coords: { latitude, longitude },
    } = await Geolocation.getCurrentPosition({ enableHighAccuracy: false });
    return { latitude, longitude };
  } catch {
    return null;
  }
};

export const getCurrentLocation = (): Promise<Point | null> => {
  if (!locationRequest) {
    locationRequest = fetchCurrentLocation().finally(() => {
      locationRequest = undefined;
    });
  }
  return locationRequest;
};

// Hook to get user's current geolocation
export const useGeo = (): [Point | null, (noLocation?: boolean) => void] => {
  const [location, setLocation] = useState<Point | null>(null);
  const [savedNoLocation] = useLocalStorage<boolean | undefined>(
    "noLocation",
    undefined
  );

  const updateLocation = async (noLocation = savedNoLocation) => {
    if ((isUndefined(noLocation) ? savedNoLocation : noLocation) === false) {
      try {
        const location = await getCurrentLocation();
        if (location) {
          setLocation(location);
        }
      } catch {}
    }
  };

  useEffect(() => {
    // get location
    updateLocation();
    // update location every 30 seconds
    const interval = setInterval(updateLocation, 30 * 1000);

    // clear interval on unmount
    return clearInterval(interval);
  }, []);

  return [location, updateLocation];
};

export const hasGeoPermissions = async (): Promise<boolean | undefined> => {
  if (navigator.permissions) {
    const { state } = await navigator.permissions.query({
      name: "geolocation",
    });
    return state === "granted";
  }
};
