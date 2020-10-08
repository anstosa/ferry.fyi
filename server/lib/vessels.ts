/**
 * Library for WSF Vessels APIs:
 * * https://www.wsdot.wa.gov/ferries/api/vessels/documentation/rest.html
 *
 * We wrap these APIs in order to orchestrate caching, proxy XML into a useful
 * format, and filter/rename the fields
 */

// imports

import { assign, cloneDeep, each, has } from "lodash";
import { DateTime } from "luxon";
import { MapPoint } from "./cameras";
import { wsfDateToTimestamp } from "./date";
import { wsfRequest } from "./api";
import logger from "heroku-logger";

// types

enum Manager {
  wsf = 1,
  kcm = 2,
}

interface VesselsLocationResponse {
  VesselID: number;
  VesselName: string;
  Mmsi?: number;
  DepartingTerminalID: number;
  DepartingTerminalName: string;
  DepartingTerminalAbbrev: string;
  ArrivingTerminalID?: number;
  ArrivingTerminalName?: string;
  ArrivingTerminalAbbrev?: string;
  Latitude: number;
  Longitude: number;
  Speed: number;
  Heading: number;
  InService: boolean;
  AtDock: boolean;
  LeftDock?: string;
  Eta?: string;
  EtaBasis?: string;
  ScheduledDeparture?: string;
  OpRouteAbbrev: string[];
  VesselPositionNum?: number;
  SortSeq: number;
  ManagedBy: Manager;
  TimeStamp: string;
}

enum VesselStatus {
  service = 1,
  maintenance = 2,
  outOfService = 3,
}

interface VesselsVerboseResponse {
  VesselID: number;
  VesselSubjectID: number;
  VesselName: string;
  VesselAbbrev: string;
  Class: {
    ClassID: number;
    ClassSubjectID: number;
    SortSeq?: number;
    DrawingImg: string;
    SilhouetteImg: string;
    PublicDisplayName: string;
  };
  Status: VesselStatus;
  OwnedByWSF: boolean;
  CarDeckRestroom: boolean;
  CarDeckShelter: boolean;
  Elevator: boolean;
  ADAAccessible: boolean;
  MainCabinGalley: boolean;
  MainCabinRestroom: boolean;
  PublicWifi: boolean;
  ADAInfo?: string;
  AdditionalInfo?: string;
  VesselNameDesc: string;
  VesselHistory?: string;
  Beam: string;
  CityBuilt: string;
  SpeedInKnots?: number;
  Draft: string;
  EngineCount?: number;
  Horsepower?: number;
  Length: string;
  MaxPassengerCount?: number;
  PassengerOnly: boolean;
  FastFerry: boolean;
  PropulsionInfo: string;
  TallDeckClearance?: number;
  RegDeckSpace?: number;
  TallDeckSpace?: number;
  Tonnage?: number;
  Displacement?: number;
  YearBuilt?: number;
  YearRebuilt?: number;
  VesselDrawingImg?: string;
  SolasCertified: boolean;
  MaxPassengerCountForInternational?: number;
}

export interface Vessel {
  abbreviation: string;
  arrivingTerminalId?: number;
  departingTerminalId?: number;
  beam: string;
  classId: number;
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
  id: number;
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
  vesselwatch: string;
  vehicleCapacity: number;
  weight: number;
  yearBuilt: number;
  yearRebuilt: number;
}

export type VesselsById = Record<number, Vessel>;

// API paths

const VESSELWATCH_BASE =
  "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=";
const API_VESSELS = "https://www.wsdot.wa.gov/ferries/api/vessels/rest";
const API_CACHE = `${API_VESSELS}/cacheflushdate`;
const API_LOCATIONS = `${API_VESSELS}/vessellocations`;
const API_VERBOSE = `${API_VESSELS}/vesselverbose`;

// local state

let lastFlushDate: number | null = null;
const vesselsById: VesselsById = {};

// local functions

const assignVessel = (id: number, vessel: Partial<Vessel>): void => {
  if (has(vesselsById, id)) {
    assign(vesselsById[id], vessel);
  } else {
    vesselsById[id] = vessel as Vessel;
  }
};

// exported functions

export const getVessels = (): VesselsById => vesselsById;

// fetches a vessel from the cache
export const getVessel = (id: number, resetDelay = false): Vessel => {
  const vessel = cloneDeep(vesselsById[id]);
  if (resetDelay) {
    delete vessel.departureDelta;
  }
  return vessel;
};

export const updateVessels = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped Vessel Update");
    return;
  } else {
    logger.info("Started Vessel Update");
  }
  lastFlushDate = cacheFlushDate;

  const vessels = await wsfRequest<VesselsVerboseResponse[]>(API_VERBOSE);
  if (!vessels) {
    return;
  }
  each(vessels, (vessel) => {
    assignVessel(vessel.VesselID, {
      abbreviation: vessel.VesselAbbrev,
      beam: vessel.Beam,
      classId: vessel.Class.ClassID,
      hasCarDeckRestroom: vessel.CarDeckRestroom,
      hasElevator: vessel.Elevator,
      hasGalley: vessel.MainCabinGalley,
      hasRestroom: vessel.CarDeckRestroom || vessel.MainCabinRestroom,
      hasWiFi: vessel.PublicWifi,
      horsepower: vessel.Horsepower,
      id: vessel.VesselID,
      inMaintenance: vessel.Status === 2,
      inService: vessel.Status === 1,
      info: {
        ada: vessel.ADAInfo,
      },
      isAdaAccessible: vessel.ADAAccessible,
      length: vessel.Length,
      maxClearance: vessel.TallDeckClearance,
      name: vessel.VesselName,
      passengerCapacity: vessel.MaxPassengerCount,
      speed: vessel.SpeedInKnots,
      tallVehicleCapacity: vessel.TallDeckSpace,
      vesselwatch: `${VESSELWATCH_BASE}${vessel.VesselName}`,
      vehicleCapacity: (vessel.RegDeckSpace || 0) + (vessel.TallDeckSpace || 0),
      weight: vessel.Tonnage,
      yearBuilt: vessel.YearBuilt,
      yearRebuilt: vessel.YearRebuilt,
    });
  });
  logger.info("Completed Vessel Update");
};

export const updateVesselStatus = async (): Promise<any> => {
  logger.info("Started Vessel Status Update");
  const vessels = await wsfRequest<VesselsLocationResponse[]>(API_LOCATIONS);
  if (!vessels) {
    return;
  }
  each(vessels, (vessel) => {
    const departedTime = wsfDateToTimestamp(vessel.LeftDock);
    const departureTime = wsfDateToTimestamp(vessel.ScheduledDeparture);
    const estimatedArrivalTime = wsfDateToTimestamp(vessel.Eta);
    let departureDelta: number | undefined;
    if (departureTime && departedTime) {
      departureDelta = departedTime - departureTime;
    } else {
      departureDelta = vesselsById?.[vessel.VesselID]?.departureDelta;
    }
    const previousVessel = vesselsById[vessel.VesselID];
    let dockedTime: number | undefined;
    if (vessel.AtDock && !previousVessel?.isAtDock) {
      dockedTime = DateTime.local().toMillis();
    }
    assignVessel(vessel.VesselID, {
      arrivingTerminalId: vessel.ArrivingTerminalID,
      departingTerminalId: vessel.DepartingTerminalID,
      departedTime,
      departureDelta,
      dockedTime,
      estimatedArrivalTime,
      heading: vessel.Heading,
      id: vessel.VesselID,
      isAtDock: vessel.AtDock,
      location: {
        latitude: vessel.Latitude,
        longitude: vessel.Longitude,
      },
      mmsi: vessel.Mmsi,
      speed: vessel.Speed,
      info: {
        ...vesselsById[vessel.VesselID]?.info,
        crossing: vessel.EtaBasis,
      },
    });
  });
  logger.info("Completed Vessel Status Update");
};
