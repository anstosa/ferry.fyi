export interface TerminalPoint {
  latitude: number;
  longitude: number;
}

export interface TerminalLocationPoints {
  booth: TerminalPoint | null;
  dock: TerminalPoint | null;
}

export interface AdminTerminalLocation extends TerminalLocationPoints {
  abbreviation: string;
  defaultDock: TerminalPoint | null;
  name: string;
  terminalId: string;
  updatedAt: string | null;
}

export interface AdminTerminalLocationsResponse {
  terminals: AdminTerminalLocation[];
}

// validate finite points within the supported ferry region
export const isTerminalPoint = (value: unknown): value is TerminalPoint => {
  // reject malformed points and accidental provider metadata
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const point = value as TerminalPoint;
  return (
    Object.keys(point).sort().join(",") === "latitude,longitude" &&
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= 45 &&
    point.latitude <= 50 &&
    point.longitude >= -125 &&
    point.longitude <= -119
  );
};
