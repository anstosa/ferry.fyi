export interface GalleyHoursRule {
  vesselPosition: number;
  days: number[];
  startTime: string;
  endTime: string;
}

export interface Route {
  id: string;
  abbreviation: string;
  date: string;
  description: string;
  crossingTime: number;
  terminalIds: string[];
  averageVehicleCapacity?: number;
  galleyHours?: GalleyHoursRule[];
  normalVehicleCapacity?: number;
  normalVehicleMaxCapacity?: number;
}
