import { Vessel } from "./vessels";

export interface Crossing {
  arrivalId: number;
  departureDelta: number | null;
  departureId: number;
  departureTime: number;
  driveUpCapacity: number;
  hasDriveUp: boolean;
  hasReservations: boolean;
  isCancelled: boolean;
  reservableCapacity: number;
  totalCapacity: number;
}

export interface CrossingEstimate {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

export interface Slot {
  allowsPassengers: boolean;
  allowsVehicles: boolean;
  crossing?: Crossing;
  estimate?: CrossingEstimate;
  hasPassed: boolean;
  time: number;
  vessel: Vessel;
  wuid: string;
}

export interface GetScheduleResponse {
  schedule: Slot[];
  timestamp: number;
}
