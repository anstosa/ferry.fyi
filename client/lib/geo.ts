import { Geolocation } from "@capacitor/geolocation";
import { useEffect, useState } from "react";

export interface Point {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS = 3956;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

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

// Hook to get user's current geolocation
export const useGeo = (): Point | null => {
  const [location, setLocation] = useState<Point | null>(null);

  const updateLocation = async () => {
    const {
      coords: { latitude, longitude },
    } = await Geolocation.getCurrentPosition();
    setLocation({ latitude, longitude });
  };

  useEffect(() => {
    // get location
    updateLocation();
    // update location every 10 seconds
    const interval = setInterval(updateLocation, 10000);

    // clear interval on unmount
    return clearInterval(interval);
  }, []);

  return location;
};

export const hasGeoPermissions = async (): Promise<boolean | undefined> => {
  if (navigator.permissions) {
    const { state } = await navigator.permissions.query({
      name: "geolocation",
    });
    return state === "granted";
  }
};
