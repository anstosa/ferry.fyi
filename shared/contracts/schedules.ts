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
  vesselId?: string | null;
  vesselName?: string | null;
}

export interface CrossingEstimate {
  confidence?: ForecastConfidence;
  driveUpCapacity: number;
  reservableCapacity: number | null;
  sampleSize?: number;
  source?: ForecastSource;
}

export interface SlotWeather {
  windGustKmh: number | null;
  windSpeedKmh: number | null;
}

export interface SlotTide {
  arrivalStationId?: string;
  arrivalWaterLevelM?: number | null;
  lowestWaterLevelM?: number | null;
  stationId: string;
  waterLevelM: number | null;
}

export type ForecastConfidence = "low" | "medium" | "high";

export type ForecastSource = "blended" | "disruption" | "historical" | "live";

export type CancellationReason = "tidal";

export interface Slot {
  allowsPassengers: boolean;
  allowsVehicles: boolean;
  arrivalTime?: number;
  cancellationReason?: CancellationReason;
  crossing?: Crossing;
  estimate?: CrossingEstimate;
  hasPassed: boolean;
  mateId: string;
  time: number;
  vessel: Vessel;
  vesselPosition?: number;
  tide?: SlotTide;
  weather?: SlotWeather;
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
