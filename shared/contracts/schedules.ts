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
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

export interface Slot {
  allowsPassengers: boolean;
  allowsVehicles: boolean;
  crossing?: Crossing;
  estimate?: CrossingEstimate;
  hasPassed: boolean;
  mateId: string;
  time: number;
  vessel: Vessel;
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
