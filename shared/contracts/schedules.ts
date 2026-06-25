import { Vessel } from "./vessels";

export interface Crossing {
  arrivalId: string;
  departureDelta: number | null;
  departureId: string;
  departureTime: number;
  driveUpCapacity: number;
  hasDriveUp: boolean;
  hasReservations: boolean;
  isCancelled: boolean;
  reservableCapacity: number;
  totalCapacity: number;
}

export interface CrossingEstimate {
  confidence?: ForecastConfidence;
  driveUpCapacity: number;
  reservableCapacity: number | null;
  sampleSize?: number;
  source?: ForecastSource;
}

export type ForecastConfidence = "low" | "medium" | "high";

export type ForecastSource = "blended" | "disruption" | "historical" | "live";

export interface Slot {
  allowsPassengers: boolean;
  allowsVehicles: boolean;
  crossing?: Crossing;
  estimate?: CrossingEstimate;
  hasPassed: boolean;
  mateId: string;
  time: number;
  vessel: Vessel;
  vesselPosition?: number;
  wuid: string;
}

export interface ValidRange {
  from: number;
  to: number;
}

export interface Schedule {
  date: string;
  key: string;
  validRange: ValidRange | null;
  slots: Slot[];
  terminalId: string;
  mateId: string;
}
