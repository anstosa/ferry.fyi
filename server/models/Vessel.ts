import { MapPoint } from "shared/contracts/cameras";
import { Vessel as VesselClass } from "shared/contracts/vessels";
import { isNil } from "shared/lib/identity";

import { CacheableModel } from "./CacheableModel";

export class Vessel extends CacheableModel implements VesselClass {
  static cacheKey = "vessels";
  static index = "id";

  /* eslint-disable lines-between-class-members */
  abbreviation!: string;
  arrivingTerminalId!: number;
  departingTerminalId!: number;
  beam!: string;
  classId!: string;
  departedTime!: number;
  departureDelta!: number;
  scheduledDepartureTime!: number;
  gpsDelay!: VesselClass["gpsDelay"];
  dockedTime!: number;
  estimatedArrivalTime!: number;
  hasCarDeckRestroom!: boolean;
  hasElevator!: boolean;
  hasGalley!: boolean;
  hasRestroom!: boolean;
  hasWiFi!: boolean;
  heading!: number;
  horsepower!: number;
  id!: string;
  inMaintenance!: boolean;
  inService!: boolean;
  info!: {
    ada?: string;
    crossing?: string;
  };
  isAdaAccessible!: boolean;
  isAtDock!: boolean;
  length!: string;
  location!: MapPoint;
  maxClearance!: number;
  mmsi!: number;
  name!: string;
  passengerCapacity!: number;
  speed!: number;
  /** In-memory timestamp for freshness checks; never exposed in the API. */
  statusUpdatedAt!: number;
  tallVehicleCapacity!: number;
  vesselWatchUrl!: string;
  vehicleCapacity!: number;
  weight!: number;
  yearBuilt!: number;
  yearRebuilt!: number;
  /* eslint-disable lines-between-class-members */

  // public vessel serialization
  serialize(): VesselClass {
    return CacheableModel.serialize({
      abbreviation: this.abbreviation,
      // omit nullish arrival
      ...(isNil(this.arrivingTerminalId)
        ? {}
        : { arrivingTerminalId: this.arrivingTerminalId }),
      departingTerminalId: this.departingTerminalId,
      beam: this.beam,
      classId: this.classId,
      departedTime: this.departedTime,
      departureDelta: this.departureDelta,
      // omit nullish scheduled departure
      ...(isNil(this.scheduledDepartureTime)
        ? {}
        : { scheduledDepartureTime: this.scheduledDepartureTime }),
      gpsDelay: this.gpsDelay,
      dockedTime: this.dockedTime,
      estimatedArrivalTime: this.estimatedArrivalTime,
      hasCarDeckRestroom: this.hasCarDeckRestroom,
      hasElevator: this.hasElevator,
      hasGalley: this.hasGalley,
      hasRestroom: this.hasRestroom,
      hasWiFi: this.hasWiFi,
      heading: this.heading,
      horsepower: this.horsepower,
      id: this.id,
      inMaintenance: this.inMaintenance,
      inService: this.inService,
      info: {
        // omit nullish details
        ...(isNil(this.info?.ada) ? {} : { ada: this.info.ada }),
        ...(isNil(this.info?.crossing) ? {} : { crossing: this.info.crossing }),
      },
      isAdaAccessible: this.isAdaAccessible,
      isAtDock: this.isAtDock,
      length: this.length,
      location: this.location,
      maxClearance: this.maxClearance,
      mmsi: this.mmsi,
      name: this.name,
      passengerCapacity: this.passengerCapacity,
      speed: this.speed,
      tallVehicleCapacity: this.tallVehicleCapacity,
      vesselWatchUrl: this.vesselWatchUrl,
      vehicleCapacity: this.vehicleCapacity,
      weight: this.weight,
      yearBuilt: this.yearBuilt,
      // omit nullish rebuild
      ...(isNil(this.yearRebuilt) ? {} : { yearRebuilt: this.yearRebuilt }),
    });
  }
}
