import { MapPoint } from "./cameras";

export type GpsDelayConfidence = "low" | "medium" | "high";

export interface GpsDelaySignals {
  dockDelaySeconds: number | null;
  etaDelaySeconds: number | null;
  progress: number;
  scheduledArrivalTime: number;
  scheduledDepartureTime: number;
}

export interface GpsDelayDetails {
  confidence: GpsDelayConfidence;
  delaySeconds: number;
  explanation: string;
  signals: GpsDelaySignals;
  source: "gps";
}

export interface Vessel {
  abbreviation: string;
  arrivingTerminalId?: number;
  departingTerminalId?: number;
  beam: string;
  classId: string;
  departedTime?: number;
  departureDelta?: number;
  gpsDelay?: GpsDelayDetails;
  dockedTime?: number;
  estimatedArrivalTime?: number;
  hasCarDeckRestroom: boolean;
  hasElevator: boolean;
  hasGalley: boolean;
  hasRestroom: boolean;
  hasWiFi: boolean;
  heading?: number;
  horsepower: number;
  id: string;
  inMaintenance: boolean;
  inService: boolean;
  info: {
    ada?: string;
    crossing?: string;
  };
  isAdaAccessible: boolean;
  isAtDock?: boolean;
  length?: string;
  location?: MapPoint;
  maxClearance: number;
  mmsi?: number;
  name: string;
  passengerCapacity: number;
  speed: number;
  tallVehicleCapacity: number;
  vesselWatchUrl: string;
  vehicleCapacity: number;
  weight: number;
  yearBuilt: number;
  yearRebuilt: number;
}

/** Current fleet data plus the oldest vessel-status observation in the set. */
export interface VesselSnapshot {
  sourceUpdatedAt: number | null;
  vessels: Record<string, Vessel>;
}
