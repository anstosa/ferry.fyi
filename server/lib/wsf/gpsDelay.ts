import type { MapPoint } from "shared/contracts/cameras";
import type {
  GpsDelayConfidence,
  GpsDelayDetails,
} from "shared/contracts/vessels";
import { constrain, round } from "shared/lib/math";

interface GpsDelayInput {
  arrivalLocation?: MapPoint | null;
  departureLocation?: MapPoint | null;
  dockDelaySeconds?: number | null;
  etaDelaySeconds?: number | null;
  now: number;
  scheduledArrivalTime: number;
  scheduledDepartureTime: number;
  vesselLocation?: MapPoint | null;
}

interface GpsDelayLeg {
  arrivalLocation: MapPoint;
  departureLocation: MapPoint;
  scheduledArrivalTime: number;
  scheduledDepartureTime: number;
}

interface GpsDelaySchedule {
  mateId: string;
  slots: Array<{
    arrivalTime?: number;
    time: number;
    vessel?: { id: string };
  }>;
  terminalId: string;
}

interface GpsDelayTerminal {
  id: string;
  location: MapPoint;
}

interface FindGpsDelayLegInput {
  arrivalTerminalId?: number | string | null;
  departureTerminalId?: number | string | null;
  scheduledDepartureTime?: number | null;
  schedules: GpsDelaySchedule[];
  terminals: GpsDelayTerminal[];
  vesselId: string;
}

interface ProjectedProgress {
  distanceFromRoute: number;
  progress: number;
}

const EARTH_LATITUDE_MILES = 69;
const MIN_ROUTE_MILES = 0.1;
const LOW_CONFIDENCE_DISTANCE_MILES = 1;
const MAX_SCHEDULE_MATCH_SECONDS = 2 * 60 * 60;

// terminal lookup
const findTerminalLocation = (
  terminals: GpsDelayTerminal[],
  terminalId: number | string
): MapPoint | null => {
  const normalizedTerminalId = String(terminalId);
  const terminal = terminals.find(({ id }) => {
    // terminal id match
    return id === normalizedTerminalId;
  });
  return terminal?.location ?? null;
};

// slot time distance
const getTimeDistance = (
  scheduledDepartureTime: number,
  slot: GpsDelaySchedule["slots"][number]
): number => Math.abs(slot.time - scheduledDepartureTime);

// active GPS leg
export const findGpsDelayLeg = ({
  arrivalTerminalId,
  departureTerminalId,
  scheduledDepartureTime,
  schedules,
  terminals,
  vesselId,
}: FindGpsDelayLegInput): GpsDelayLeg | null => {
  // leg identity guard
  if (!arrivalTerminalId || !departureTerminalId || !scheduledDepartureTime) {
    return null;
  }
  const departureLocation = findTerminalLocation(
    terminals,
    departureTerminalId
  );
  const arrivalLocation = findTerminalLocation(terminals, arrivalTerminalId);
  // terminal location guard
  if (!departureLocation || !arrivalLocation) {
    return null;
  }
  const departureId = String(departureTerminalId);
  const arrivalId = String(arrivalTerminalId);
  const matchingSchedules = schedules.filter((candidate) => {
    // matching route guard
    return (
      candidate.terminalId === departureId && candidate.mateId === arrivalId
    );
  });
  const matchingSlots = matchingSchedules
    .flatMap((schedule) => {
      // route slots
      return schedule.slots;
    })
    .filter((slot) => {
      // vessel match guard
      return slot.vessel?.id === vesselId && Boolean(slot.arrivalTime);
    })
    .sort((left, right) => {
      // closest schedule first
      return (
        getTimeDistance(scheduledDepartureTime, left) -
        getTimeDistance(scheduledDepartureTime, right)
      );
    });
  const [slot] = matchingSlots;
  // slot guard
  if (
    !slot ||
    getTimeDistance(scheduledDepartureTime, slot) > MAX_SCHEDULE_MATCH_SECONDS
  ) {
    return null;
  }
  return {
    arrivalLocation,
    departureLocation,
    scheduledArrivalTime: slot.arrivalTime as number,
    scheduledDepartureTime: slot.time,
  };
};

// point projection
const projectProgress = (
  departureLocation: MapPoint,
  arrivalLocation: MapPoint,
  vesselLocation: MapPoint
): ProjectedProgress | null => {
  const averageLatitude =
    ((departureLocation.latitude + arrivalLocation.latitude) / 2) *
    (Math.PI / 180);
  const longitudeMiles = EARTH_LATITUDE_MILES * Math.cos(averageLatitude);
  const routeX =
    (arrivalLocation.longitude - departureLocation.longitude) * longitudeMiles;
  const routeY =
    (arrivalLocation.latitude - departureLocation.latitude) *
    EARTH_LATITUDE_MILES;
  const vesselX =
    (vesselLocation.longitude - departureLocation.longitude) * longitudeMiles;
  const vesselY =
    (vesselLocation.latitude - departureLocation.latitude) *
    EARTH_LATITUDE_MILES;
  const routeLengthSquared = routeX * routeX + routeY * routeY;
  // route length guard
  if (routeLengthSquared < MIN_ROUTE_MILES * MIN_ROUTE_MILES) {
    return null;
  }
  const rawProgress =
    (vesselX * routeX + vesselY * routeY) / routeLengthSquared;
  const progress = constrain(rawProgress, 0, 1);
  const nearestX = routeX * progress;
  const nearestY = routeY * progress;
  const distanceFromRoute = Math.sqrt(
    (vesselX - nearestX) * (vesselX - nearestX) +
      (vesselY - nearestY) * (vesselY - nearestY)
  );
  return { distanceFromRoute, progress };
};

// progress confidence
const getConfidence = (
  projected: ProjectedProgress,
  hasSupportingSignal: boolean
): GpsDelayConfidence => {
  // off-route guard
  if (projected.distanceFromRoute > LOW_CONFIDENCE_DISTANCE_MILES) {
    return "low";
  }
  // supporting signal guard
  if (hasSupportingSignal) {
    return "high";
  }
  return "medium";
};

// GPS delay for active leg
export const calculateGpsDelayForLeg = (
  input: Omit<
    GpsDelayInput,
    | "arrivalLocation"
    | "departureLocation"
    | "scheduledArrivalTime"
    | "scheduledDepartureTime"
  > & {
    leg: GpsDelayLeg;
  }
): GpsDelayDetails | null => {
  const { leg, ...rest } = input;
  return calculateGpsDelay({
    ...rest,
    arrivalLocation: leg.arrivalLocation,
    departureLocation: leg.departureLocation,
    scheduledArrivalTime: leg.scheduledArrivalTime,
    scheduledDepartureTime: leg.scheduledDepartureTime,
  });
};

// GPS delay details
export const calculateGpsDelay = ({
  arrivalLocation,
  departureLocation,
  dockDelaySeconds,
  etaDelaySeconds,
  now,
  scheduledArrivalTime,
  scheduledDepartureTime,
  vesselLocation,
}: GpsDelayInput): GpsDelayDetails | null => {
  // data availability guard
  if (!departureLocation || !arrivalLocation || !vesselLocation) {
    return null;
  }
  const scheduledDuration = scheduledArrivalTime - scheduledDepartureTime;
  // schedule duration guard
  if (scheduledDuration <= 0) {
    return null;
  }
  const projected = projectProgress(
    departureLocation,
    arrivalLocation,
    vesselLocation
  );
  // projection guard
  if (!projected) {
    return null;
  }
  const expectedTimeAtProgress =
    scheduledDepartureTime + projected.progress * scheduledDuration;
  const delaySeconds = round(now - expectedTimeAtProgress);
  const hasSupportingSignal =
    etaDelaySeconds !== null &&
    etaDelaySeconds !== undefined &&
    dockDelaySeconds !== null &&
    dockDelaySeconds !== undefined;
  return {
    confidence: getConfidence(projected, hasSupportingSignal),
    delaySeconds,
    explanation:
      "GPS delay compares the vessel's current route progress with scheduled progress.",
    signals: {
      dockDelaySeconds: dockDelaySeconds ?? null,
      etaDelaySeconds: etaDelaySeconds ?? null,
      progress: round(projected.progress, 4),
      scheduledArrivalTime,
      scheduledDepartureTime,
    },
    source: "gps",
  };
};
