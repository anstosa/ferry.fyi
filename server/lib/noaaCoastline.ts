import type { LocationPoint } from "./leaderboards";

/** 500 ft. A location is eligible only when its accuracy circle stays offshore. */
export const MIN_OFFSHORE_DISTANCE_METERS = 152.4;

export interface GeoJsonFeature {
  geometry: { coordinates: unknown; type: string } | null;
  properties?: { snapshotLayer?: string };
}

export interface CoastlineSnapshot {
  features: GeoJsonFeature[];
}

const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number" &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

const toLocalMeters = (origin: LocationPoint, position: [number, number]) => {
  const latitudeRadians = (origin.latitude * Math.PI) / 180;
  return {
    x:
      ((position[0] - origin.longitude) *
        Math.PI *
        6_371_000 *
        Math.cos(latitudeRadians)) /
      180,
    y: ((position[1] - origin.latitude) * Math.PI * 6_371_000) / 180,
  };
};

const segmentDistanceMeters = (
  origin: LocationPoint,
  start: [number, number],
  end: [number, number]
): number => {
  const a = toLocalMeters(origin, start);
  const b = toLocalMeters(origin, end);
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, -(a.x * (b.x - a.x) + a.y * (b.y - a.y)) / lengthSquared)
        );
  return Math.hypot(a.x + fraction * (b.x - a.x), a.y + fraction * (b.y - a.y));
};

const pointInRing = (point: LocationPoint, ring: unknown): boolean => {
  if (!Array.isArray(ring)) {
    return false;
  }
  let inside = false;
  let previous: [number, number] | null = null;
  for (const value of ring) {
    if (!isPosition(value)) {
      return false;
    }
    if (previous) {
      const [x1, y1] = previous;
      const [x2, y2] = value;
      if (y1 > point.latitude !== y2 > point.latitude) {
        const crossing = ((x2 - x1) * (point.latitude - y1)) / (y2 - y1) + x1;
        if (point.longitude < crossing) {
          inside = !inside;
        }
      }
    }
    previous = value;
  }
  return inside;
};

const pointInPolygon = (point: LocationPoint, coordinates: unknown): boolean =>
  Array.isArray(coordinates) &&
  coordinates.length > 0 &&
  pointInRing(point, coordinates[0]) &&
  !coordinates.slice(1).some((ring) => pointInRing(point, ring));

const pointHasKnownCoverage = (
  point: LocationPoint,
  features: GeoJsonFeature[]
): boolean =>
  features.some(
    ({ geometry, properties }) =>
      properties?.snapshotLayer === "coverage" &&
      geometry &&
      (geometry.type === "Polygon"
        ? pointInPolygon(point, geometry.coordinates)
        : geometry.type === "MultiPolygon" &&
          Array.isArray(geometry.coordinates) &&
          geometry.coordinates.some((polygon) =>
            pointInPolygon(point, polygon)
          ))
  );

const coastlineDistanceMeters = (
  point: LocationPoint,
  features: GeoJsonFeature[]
): number | null => {
  let nearest = Infinity;
  let hasLine = false;
  for (const { geometry, properties } of features) {
    if (properties?.snapshotLayer !== "coastline" || !geometry) {
      continue;
    }
    let lines: unknown[] = [];
    if (geometry.type === "LineString") {
      lines = [geometry.coordinates];
    } else if (geometry.type === "MultiLineString") {
      lines = geometry.coordinates as unknown[];
    }
    for (const line of lines) {
      if (!Array.isArray(line)) {
        continue;
      }
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        if (!isPosition(start) || !isPosition(end)) {
          continue;
        }
        hasLine = true;
        nearest = Math.min(nearest, segmentDistanceMeters(point, start, end));
      }
    }
  }
  return hasLine ? nearest : null;
};

export type CoastlineEligibility =
  | { eligible: true; shoreDistanceMeters: number }
  | {
      eligible: false;
      reason: "COASTLINE_COVERAGE_UNKNOWN" | "TOO_CLOSE_TO_SHORE";
    };

/**
 * This is a non-navigation eligibility check.  It deliberately fails closed
 * when the snapshot has no unambiguous ENC Harbour coverage for the point.
 */
export const evaluateOffshoreEligibility = (
  point: LocationPoint,
  accuracyMeters: number,
  snapshot: CoastlineSnapshot
): CoastlineEligibility => {
  if (!pointHasKnownCoverage(point, snapshot.features)) {
    return { eligible: false, reason: "COASTLINE_COVERAGE_UNKNOWN" };
  }
  const shoreDistanceMeters = coastlineDistanceMeters(point, snapshot.features);
  if (
    shoreDistanceMeters === null ||
    shoreDistanceMeters - accuracyMeters < MIN_OFFSHORE_DISTANCE_METERS
  ) {
    return { eligible: false, reason: "TOO_CLOSE_TO_SHORE" };
  }
  return { eligible: true, shoreDistanceMeters };
};
