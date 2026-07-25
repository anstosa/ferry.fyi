import type { Vessel } from "shared/contracts/vessels";

import { ForegroundLocation, getDistance, Point } from "./geo";

const GEOFENCE_METERS = 1000 * 0.3048;
const VESSEL_PROXIMITY_METERS = 250;

export const canWatchLeaderboardForegroundCheckins = (
  isAuthenticated: boolean,
  isEnrolled: boolean,
  isOptedOut = false
): boolean => isAuthenticated && isEnrolled && !isOptedOut;

/** Poll again after any completed fix, including a null/denied result. */
export const shouldContinueForegroundLocationPolling = (
  isAuthenticated: boolean,
  isEnrolled: boolean,
  isVisible: boolean,
  watcherActive: boolean,
  isOptedOut = false
): boolean =>
  watcherActive &&
  isVisible &&
  canWatchLeaderboardForegroundCheckins(
    isAuthenticated,
    isEnrolled,
    isOptedOut
  );

const distanceMeters = (location: Point, terminal: Point): number =>
  getDistance(location, terminal) * 1609.344;

/** A position and its accuracy circle are wholly inside the terminal fence. */
export const isDefinitelyInsideTerminal = (
  location: ForegroundLocation,
  terminal: Point
): boolean =>
  distanceMeters(location, terminal) + location.accuracyMeters <=
  GEOFENCE_METERS;

/** A position and its accuracy circle are wholly outside the terminal fence. */
export const isDefinitelyOutsideTerminal = (
  location: ForegroundLocation,
  terminal: Point
): boolean =>
  distanceMeters(location, terminal) - location.accuracyMeters >
  GEOFENCE_METERS;

/** A position and accuracy circle must be completely within vessel range. */
export const isDefinitelyNearVessel = (
  location: ForegroundLocation,
  vessel: Point
): boolean =>
  distanceMeters(location, vessel) + location.accuracyMeters <=
  VESSEL_PROXIMITY_METERS;

/**
 * The client echoes the public WSF sailing identity. The server recomputes it
 * from its live status and remains authoritative for every credit.
 */
export const vesselSailingId = (vessel: Vessel): string | null => {
  if (
    !vessel.inService ||
    vessel.isAtDock ||
    !vessel.location ||
    !Number.isFinite(vessel.departedTime) ||
    !Number.isFinite(vessel.departingTerminalId) ||
    !Number.isFinite(vessel.arrivingTerminalId) ||
    vessel.departingTerminalId === vessel.arrivingTerminalId
  ) {
    return null;
  }
  return `${vessel.id}:${vessel.departedTime}:${vessel.departingTerminalId}:${vessel.arrivingTerminalId}`;
};
