import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { isUndefined } from "shared/lib/identity";

import { useLocalStorage } from "./browser";
import { isNativeMobileApp } from "./device";

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
const locationRefreshers = new Map<symbol, () => Promise<void>>();
let locationRefreshInterval: number | undefined;
let isListeningForVisibility = false;

const shareLocation = (location: Point): void => {
  lastNativeLocation = location;
  locationSubscribers.forEach((setLocation) => setLocation(location));
};

const refreshSharedLocation = (): void => {
  const refresh = locationRefreshers.values().next().value;
  if (refresh && document.visibilityState === "visible") {
    refresh().catch(() => undefined);
  }
};

const stopLocationRefreshInterval = (): void => {
  if (locationRefreshInterval !== undefined) {
    window.clearInterval(locationRefreshInterval);
    locationRefreshInterval = undefined;
  }
};

const handleLocationVisibilityChange = (): void => {
  stopLocationRefreshInterval();
  if (locationRefreshers.size > 0 && document.visibilityState === "visible") {
    refreshSharedLocation();
    locationRefreshInterval = window.setInterval(
      refreshSharedLocation,
      30 * 1000
    );
  }
};

const startLocationPolling = (): void => {
  if (!isListeningForVisibility) {
    document.addEventListener(
      "visibilitychange",
      handleLocationVisibilityChange
    );
    isListeningForVisibility = true;
  }
  handleLocationVisibilityChange();
};

const stopLocationPolling = (): void => {
  stopLocationRefreshInterval();
  if (isListeningForVisibility) {
    document.removeEventListener(
      "visibilitychange",
      handleLocationVisibilityChange
    );
    isListeningForVisibility = false;
  }
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

const nativeLocation = async () =>
  (await import("@capacitor/geolocation")).Geolocation;

const fetchNativeLocation = async (): Promise<Point | null> => {
  try {
    const Geolocation = await nativeLocation();
    const {
      coords: { latitude, longitude },
    } = await Geolocation.getCurrentPosition(LOCATION_OPTIONS);
    return { latitude, longitude };
  } catch {
    return null;
  }
};

const fetchBrowserLocation = (): Promise<Point | null> =>
  new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => resolve({ latitude, longitude }),
      () => resolve(null),
      LOCATION_OPTIONS
    );
  });

export const fetchForegroundLocation =
  async (): Promise<ForegroundLocation | null> => {
    try {
      const Geolocation = await nativeLocation();
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

const getLocation = (promptsForPermission: boolean): Promise<Point | null> => {
  // Android's checkPermissions() reaches the native location service and has
  // caused startup crashes on affected devices. Never invoke the plugin from a
  // background refresh; getCurrentPosition() owns the permission flow after an
  // explicit user action instead.
  const native = isNativeMobileApp();
  if (native) {
    if (!promptsForPermission) {
      return Promise.resolve(lastNativeLocation);
    }
  }

  if (!locationRequest) {
    // Browser geolocation must be invoked synchronously from the user's click
    // handler. Native plugin loading can remain deferred after that platform
    // has been identified synchronously.
    locationRequest = (
      native ? fetchNativeLocation() : fetchBrowserLocation()
    ).finally(() => {
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
          requestPermission || isNativeMobileApp()
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
    const subscriber = Symbol("location refresher");
    const wasEmpty = locationRefreshers.size === 0;
    locationRefreshers.set(subscriber, updateLocation);
    if (wasEmpty) {
      startLocationPolling();
    }
    return () => {
      locationRefreshers.delete(subscriber);
      if (locationRefreshers.size === 0) {
        stopLocationPolling();
      }
    };
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
