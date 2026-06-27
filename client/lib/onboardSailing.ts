import type { MapPoint } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { constrain, round } from "shared/lib/math";

import { getDistance, Point } from "./geo";

interface ProjectedPoint {
  distanceFromRoute: number;
  progress: number;
}

export interface OnboardSailingMatch {
  departureTerminal: Terminal;
  destinationTerminal: Terminal;
  distanceMiles: number;
  etaMinutes: number;
  progress: number;
  vessel: Vessel;
}

interface GetOnboardSailingInput {
  simulatedVesselId?: string | null;
  terminals: Terminal[];
  userLocation: Point | null;
  vessels: Vessel[];
}

interface GetTrackedSailingInput {
  terminals: Terminal[];
  vesselId: string | null;
  vessels: Vessel[];
}

const EARTH_LATITUDE_MILES = 69;
const MAX_ONBOARD_DISTANCE_MILES = 0.5;
const MAX_ROUTE_DISTANCE_MILES = 0.35;
const MIN_ON_WATER_PROGRESS = 0.03;
const MAX_ON_WATER_PROGRESS = 0.97;
const MIN_MOVING_SPEED_KNOTS = 1;
const SIMULATED_DISTANCE_MILES = 0;
const ARRIVED_GRACE_SECONDS = 10 * 60;
const ARRIVED_DESTINATION_DISTANCE_MILES = 0.25;

interface GetArrivedSailingInput {
  now: number;
  previousSailing: OnboardSailingMatch | null;
  vessels: Vessel[];
}

// timestamp normalizer
const normalizeTimestampSeconds = (time?: number): number | null => {
  // missing time guard
  if (!time) {
    return null;
  }
  // millisecond timestamp guard
  if (time > 100_000_000_000) {
    return time / 1000;
  }
  return time;
};

// destination dock check
const isDockedAtDestination = (
  sailing: OnboardSailingMatch,
  vessel: Vessel
): boolean => {
  const destinationId = sailing.destinationTerminal.id;
  const vesselTerminalIds = [
    vessel.arrivingTerminalId,
    vessel.departingTerminalId,
  ].map((terminalId) => String(terminalId ?? ""));
  // explicit terminal guard
  if (vesselTerminalIds.includes(destinationId)) {
    return true;
  }
  // location fallback guard
  if (!vessel.location) {
    return false;
  }
  return (
    getDistance(vessel.location, sailing.destinationTerminal.location) <=
    ARRIVED_DESTINATION_DISTANCE_MILES
  );
};

// terminal id lookup
const getTerminalById = (
  terminals: Terminal[],
  terminalId?: number | string
): Terminal | null => {
  // terminal id guard
  if (terminalId === undefined) {
    return null;
  }
  const normalizedTerminalId = String(terminalId);
  return (
    terminals.find((terminal) => {
      // terminal match
      return terminal.id === normalizedTerminalId;
    }) ?? null
  );
};

// route projection
export const projectPointToRoute = (
  departureLocation: MapPoint,
  arrivalLocation: MapPoint,
  point: MapPoint
): ProjectedPoint | null => {
  const averageLatitude =
    ((departureLocation.latitude + arrivalLocation.latitude) / 2) *
    (Math.PI / 180);
  const longitudeMiles = EARTH_LATITUDE_MILES * Math.cos(averageLatitude);
  const routeX =
    (arrivalLocation.longitude - departureLocation.longitude) * longitudeMiles;
  const routeY =
    (arrivalLocation.latitude - departureLocation.latitude) *
    EARTH_LATITUDE_MILES;
  const pointX =
    (point.longitude - departureLocation.longitude) * longitudeMiles;
  const pointY =
    (point.latitude - departureLocation.latitude) * EARTH_LATITUDE_MILES;
  const routeLengthSquared = routeX * routeX + routeY * routeY;
  // route length guard
  if (routeLengthSquared <= 0) {
    return null;
  }
  const rawProgress = (pointX * routeX + pointY * routeY) / routeLengthSquared;
  const progress = constrain(rawProgress, 0, 1);
  const nearestX = routeX * progress;
  const nearestY = routeY * progress;
  const distanceFromRoute = Math.sqrt(
    (pointX - nearestX) * (pointX - nearestX) +
      (pointY - nearestY) * (pointY - nearestY)
  );
  return { distanceFromRoute, progress };
};

// on-water progress check
const isOnWaterProgress = (progress: number): boolean => {
  return progress >= MIN_ON_WATER_PROGRESS && progress <= MAX_ON_WATER_PROGRESS;
};

// ferry candidate check
const isMovingFerry = (vessel: Vessel): boolean => {
  return (
    Boolean(vessel.location) &&
    Boolean(vessel.gpsDelay) &&
    !vessel.isAtDock &&
    vessel.speed >= MIN_MOVING_SPEED_KNOTS
  );
};

// build onboard match
const getVesselMatch = ({
  allowTerminalProgress = false,
  distanceMiles,
  terminals,
  vessel,
}: {
  allowTerminalProgress?: boolean;
  distanceMiles: number;
  terminals: Terminal[];
  vessel: Vessel;
}): OnboardSailingMatch | null => {
  const departureTerminal = getTerminalById(
    terminals,
    vessel.departingTerminalId
  );
  const destinationTerminal = getTerminalById(
    terminals,
    vessel.arrivingTerminalId
  );
  // route identity guard
  if (!departureTerminal || !destinationTerminal) {
    return null;
  }
  const { gpsDelay } = vessel;
  // gps delay guard
  if (!gpsDelay) {
    return null;
  }
  const progress = constrain(gpsDelay.signals.progress, 0, 1);
  // vessel on-water guard
  if (!allowTerminalProgress && !isOnWaterProgress(progress)) {
    return null;
  }
  const { scheduledArrivalTime, scheduledDepartureTime } = gpsDelay.signals;
  const scheduledDuration = scheduledArrivalTime - scheduledDepartureTime;
  const remainingCrossingSeconds = scheduledDuration * (1 - progress);
  const etaMinutes = Math.max(1, round(remainingCrossingSeconds / 60));
  return {
    departureTerminal,
    destinationTerminal,
    distanceMiles,
    etaMinutes,
    progress,
    vessel,
  };
};

// user location match
const getLocationMatch = ({
  terminals,
  userLocation,
  vessel,
}: {
  terminals: Terminal[];
  userLocation: Point;
  vessel: Vessel;
}): OnboardSailingMatch | null => {
  const departureTerminal = getTerminalById(
    terminals,
    vessel.departingTerminalId
  );
  const destinationTerminal = getTerminalById(
    terminals,
    vessel.arrivingTerminalId
  );
  // route identity guard
  if (!departureTerminal || !destinationTerminal || !vessel.location) {
    return null;
  }
  const routeProjection = projectPointToRoute(
    departureTerminal.location,
    destinationTerminal.location,
    userLocation
  );
  // route proximity guard
  if (
    !routeProjection ||
    routeProjection.distanceFromRoute > MAX_ROUTE_DISTANCE_MILES ||
    !isOnWaterProgress(routeProjection.progress)
  ) {
    return null;
  }
  const distanceMiles = getDistance(userLocation, vessel.location);
  // onboard distance guard
  if (distanceMiles > MAX_ONBOARD_DISTANCE_MILES) {
    return null;
  }
  return getVesselMatch({ distanceMiles, terminals, vessel });
};

// estimated departure countdown
export const getEstimatedDepartureMinutes = (
  sailing: OnboardSailingMatch,
  now: number
): number => {
  const { gpsDelay } = sailing.vessel;
  // gps timing guard
  if (!gpsDelay) {
    return sailing.etaMinutes;
  }
  const projectedDepartureTime =
    gpsDelay.signals.scheduledDepartureTime + gpsDelay.delaySeconds;
  return Math.max(0, round((projectedDepartureTime - now) / 60));
};

// projected progress between updates
export const getProjectedSailingProgress = (
  sailing: OnboardSailingMatch,
  now: number
): number => {
  const { gpsDelay } = sailing.vessel;
  // gps timing guard
  if (!gpsDelay) {
    return sailing.progress;
  }
  const { scheduledArrivalTime, scheduledDepartureTime } = gpsDelay.signals;
  const scheduledDuration = scheduledArrivalTime - scheduledDepartureTime;
  // duration guard
  if (scheduledDuration <= 0) {
    return sailing.progress;
  }
  const projectedDepartureTime = scheduledDepartureTime + gpsDelay.delaySeconds;
  return constrain((now - projectedDepartureTime) / scheduledDuration, 0, 1);
};

// tracked sailing detector
export const getTrackedSailing = ({
  terminals,
  vesselId,
  vessels,
}: GetTrackedSailingInput): OnboardSailingMatch | null => {
  // tracked id guard
  if (!vesselId) {
    return null;
  }
  const vessel = vessels.find(({ id }) => {
    // matching vessel
    return id === vesselId;
  });
  // vessel guard
  if (!vessel) {
    return null;
  }
  return getVesselMatch({
    allowTerminalProgress: true,
    distanceMiles: SIMULATED_DISTANCE_MILES,
    terminals,
    vessel,
  });
};

// arrived sailing detector
export const getArrivedSailing = ({
  now,
  previousSailing,
  vessels,
}: GetArrivedSailingInput): OnboardSailingMatch | null => {
  // previous sailing guard
  if (!previousSailing) {
    return null;
  }
  const vessel = vessels.find(({ id }) => {
    // matching vessel
    return id === previousSailing.vessel.id;
  });
  // docked vessel guard
  if (!vessel?.isAtDock || !isDockedAtDestination(previousSailing, vessel)) {
    return null;
  }
  const dockedTime = normalizeTimestampSeconds(vessel.dockedTime);
  // dock timestamp guard
  if (!dockedTime || now - dockedTime > ARRIVED_GRACE_SECONDS) {
    return null;
  }
  return {
    ...previousSailing,
    etaMinutes: 0,
    progress: 1,
    vessel,
  };
};

// onboard sailing detector
export const getOnboardSailing = ({
  simulatedVesselId,
  terminals,
  userLocation,
  vessels,
}: GetOnboardSailingInput): OnboardSailingMatch | null => {
  // simulated vessel guard
  if (simulatedVesselId) {
    const simulatedVessel = vessels.find((vessel) => {
      // simulated id match
      return vessel.id === simulatedVesselId;
    });
    // simulated match guard
    if (simulatedVessel) {
      return getVesselMatch({
        distanceMiles: SIMULATED_DISTANCE_MILES,
        terminals,
        vessel: simulatedVessel,
      });
    }
  }
  // location readiness guard
  if (!userLocation) {
    return null;
  }
  const matches = vessels
    .filter(isMovingFerry)
    .map((vessel) => {
      // user location match
      return getLocationMatch({ terminals, userLocation, vessel });
    })
    .filter((match): match is OnboardSailingMatch => Boolean(match))
    .sort((left, right) => {
      // nearest vessel first
      return left.distanceMiles - right.distanceMiles;
    });
  const [match] = matches;
  return match ?? null;
};
