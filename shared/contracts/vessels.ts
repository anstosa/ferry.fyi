import { MapPoint } from "./cameras";

export interface Vessel {
  abbreviation: string;
  arrivingTerminalId?: number;
  departingTerminalId?: number;
  beam: string;
  classId: string;
  departedTime?: number;
  departureDelta?: number;
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
