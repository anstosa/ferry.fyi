import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { isUndefined } from "shared/lib/identity";

import { useLocalStorage } from "./browser";

export interface Point {
  latitude: number;
  longitude: number;
}

/** A single, user-initiated foreground fix. Never persist this object. */
export interface ForegroundLocation extends Point {
  accuracyMeters: number;
  observedAt: string;
}

const EARTH_RADIUS = 3956;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
let locationRequest: Promise<Point | null> | undefined;
let lastNativeLocation: Point | null = null;
const locationSubscribers = new Set<Dispatch<SetStateAction<Point | null>>>();

const shareLocation = (location: Point): void => {
  lastNativeLocation = location;
  locationSubscribers.forEach((setLocation) => setLocation(location));
};

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

const LOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 5 * 60 * 1000,
  timeout: 30 * 1000,
};

const nativeLocation = async () => {
  const [{ Capacitor }, { Geolocation }] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/geolocation"),
  ]);
  return { Capacitor, Geolocation };
};

const isNativeLocation = async (): Promise<boolean> =>
  (await nativeLocation()).Capacitor.isNativePlatform();

const fetchCurrentLocation = async (): Promise<Point | null> => {
  try {
    const { Geolocation } = await nativeLocation();
    const {
      coords: { latitude, longitude },
    } = await Geolocation.getCurrentPosition(LOCATION_OPTIONS);
    return { latitude, longitude };
  } catch {
    return null;
  }
};

export const fetchForegroundLocation =
  async (): Promise<ForegroundLocation | null> => {
    try {
      const { Geolocation } = await nativeLocation();
      // Credits require a fresh, high-accuracy fix acquired while this page is visible.
      const { coords, timestamp } = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30 * 1000,
      });
      return {
        accuracyMeters: coords.accuracy,
        latitude: coords.latitude,
        longitude: coords.longitude,
        observedAt: new Date(timestamp).toISOString(),
      };
    } catch {
      return null;
    }
  };

/** Request one foreground location after a user tap. The caller must discard it after use. */
export const requestForegroundLocation = fetchForegroundLocation;

const getLocation = async (
  promptsForPermission: boolean
): Promise<Point | null> => {
  // Android's checkPermissions() reaches the native location service and has
  // caused startup crashes on affected devices. Never invoke the plugin from a
  // background refresh; getCurrentPosition() owns the permission flow after an
  // explicit user action instead.
  const { Capacitor } = await nativeLocation();
  if (Capacitor.isNativePlatform()) {
    if (!promptsForPermission) {
      return Promise.resolve(lastNativeLocation);
    }
  }

  if (!locationRequest) {
    locationRequest = fetchCurrentLocation().finally(() => {
      locationRequest = undefined;
    });
  }
  return locationRequest;
};

/** Browser lookup only; native apps wait for an explicit user action. */
export const getCurrentLocation = (): Promise<Point | null> =>
  getLocation(false);

/** Get a location (and let the native plugin request permission) after a tap. */
export const requestCurrentLocation = (): Promise<Point | null> =>
  getLocation(true);

// Hook to get user's current geolocation
export const useGeo = (): [
  Point | null,
  (noLocation?: boolean, requestPermission?: boolean) => void,
] => {
  const [location, setLocation] = useState<Point | null>(lastNativeLocation);
  const [savedNoLocation] = useLocalStorage<boolean | undefined>(
    "noLocation",
    undefined
  );

  const updateLocation = async (
    noLocation = savedNoLocation,
    requestPermission = false
  ) => {
    if ((isUndefined(noLocation) ? savedNoLocation : noLocation) === false) {
      try {
        // A native user who has already opted in can refresh their location
        // without another permission prompt. New native users still need the
        // explicit RouteSelector action before the plugin is invoked.
        const location =
          requestPermission || (await isNativeLocation())
            ? await requestCurrentLocation()
            : await getCurrentLocation();
        if (location) {
          shareLocation(location);
        }
      } catch {}
    }
  };

  useEffect(() => {
    locationSubscribers.add(setLocation);
    return () => {
      locationSubscribers.delete(setLocation);
    };
  }, []);

  useEffect(() => {
    // get location
    updateLocation();
    // update location every 30 seconds
    const interval = setInterval(updateLocation, 30 * 1000);

    // clear interval on unmount
    return clearInterval(interval);
  }, [savedNoLocation]);

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
