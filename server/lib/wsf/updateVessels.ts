import logger from "heroku-logger";
import { DateTime } from "luxon";
import VESSEL_DATA_OVERRIDES from "shared/data/vessels.json";
import { values } from "shared/lib/objects";

import { calculateGpsDelayForLeg, findGpsDelayLeg } from "~/lib/wsf/gpsDelay";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { wsfDateToTimestamp } from "./date";

const VESSELWATCH_BASE =
  "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=";
const API_VESSELS = "https://www.wsdot.wa.gov/ferries/api/vessels/rest";
const API_CACHE = `${API_VESSELS}/cacheflushdate`;
const API_LOCATIONS = `${API_VESSELS}/vessellocations`;
const API_VERBOSE = `${API_VESSELS}/vesselverbose`;

interface VesselDataOverride {
  hasWiFi?: boolean;
}

// vessel metadata overrides
const VESSEL_OVERRIDES: Record<string, VesselDataOverride> =
  VESSEL_DATA_OVERRIDES;

let lastFlushDate: number | null = null;

// update vessel metadata
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

  const vessels = await wsfRequest<WSF.VesselsVerboseResponse[]>(API_VERBOSE);
  if (!vessels) {
    return;
  }
  // vessel refresh
  vessels.forEach((VesselData) => {
    const data = {
      abbreviation: VesselData.VesselAbbrev,
      beam: VesselData.Beam,
      classId: String(VesselData.Class.ClassID),
      hasCarDeckRestroom: VesselData.CarDeckRestroom,
      hasElevator: VesselData.Elevator,
      hasGalley: VesselData.MainCabinGalley,
      hasRestroom: VesselData.CarDeckRestroom || VesselData.MainCabinRestroom,
      hasWiFi: VesselData.PublicWifi,
      horsepower: VesselData.Horsepower,
      id: String(VesselData.VesselID),
      inMaintenance: VesselData.Status === WSF.VesselStatus.IN_MAINTENANCE,
      inService: VesselData.Status === WSF.VesselStatus.IN_SERVICE,
      info: {
        ada: VesselData.ADAInfo,
      },
      isAdaAccessible: VesselData.ADAAccessible,
      length: VesselData.Length,
      maxClearance: VesselData.TallDeckClearance,
      name: VesselData.VesselName,
      passengerCapacity: VesselData.MaxPassengerCount,
      speed: VesselData.SpeedInKnots,
      tallVehicleCapacity: VesselData.TallDeckSpace,
      vesselWatchUrl: `${VESSELWATCH_BASE}${VesselData.VesselName}`,
      vehicleCapacity:
        (VesselData.RegDeckSpace ?? 0) + (VesselData.TallDeckSpace ?? 0),
      weight: VesselData.Tonnage,
      yearBuilt: VesselData.YearBuilt,
      yearRebuilt: VesselData.YearRebuilt,
    };
    const override = VESSEL_OVERRIDES[String(VesselData.VesselID)];
    // local data override
    if (override) {
      Object.assign(data, override);
    }

    const [vessel, wasCreated] = Vessel.getOrCreate(
      String(VesselData.VesselID),
      data
    );
    if (!wasCreated) {
      vessel.update(data);
    }
    vessel.save();
  });
  logger.info(`Updated ${Object.keys(Vessel.getAll()).length} Vessels`);
};

export const updateVesselStatus = async (): Promise<any> => {
  logger.info("Started Vessel Status Update");
  const vessels =
    await wsfRequest<WSF.VesselsLocationResponse[]>(API_LOCATIONS);
  if (!vessels) {
    return;
  }
  const schedules = values(Schedule.getAll());
  const terminals = values(Terminal.getAll());
  const now = DateTime.local();
  vessels.forEach((VesselData) => {
    let vessel = Vessel.getByIndex(String(VesselData.VesselID));
    const departedTime = wsfDateToTimestamp(VesselData.LeftDock);
    const departureTime = wsfDateToTimestamp(VesselData.ScheduledDeparture);
    const estimatedArrivalTime = wsfDateToTimestamp(VesselData.Eta);
    let departureDelta: number | undefined;
    // dock event delay
    if (departureTime && departedTime) {
      departureDelta = departedTime - departureTime;
    } else {
      departureDelta = vessel?.departureDelta;
    }
    const gpsDelayLeg = findGpsDelayLeg({
      arrivalTerminalId: VesselData.ArrivingTerminalID,
      departureTerminalId: VesselData.DepartingTerminalID,
      scheduledDepartureTime: departureTime,
      schedules,
      terminals,
      vesselId: String(VesselData.VesselID),
    });
    const dockDelaySeconds =
      departureTime && departedTime ? departedTime - departureTime : null;
    const etaDelaySeconds =
      gpsDelayLeg && estimatedArrivalTime
        ? estimatedArrivalTime - gpsDelayLeg.scheduledArrivalTime
        : null;
    const gpsDelay = gpsDelayLeg
      ? calculateGpsDelayForLeg({
          dockDelaySeconds,
          etaDelaySeconds,
          leg: gpsDelayLeg,
          now: now.toSeconds(),
          vesselLocation: {
            latitude: VesselData.Latitude,
            longitude: VesselData.Longitude,
          },
        })
      : null;
    let dockedTime: number | undefined;
    if (VesselData.AtDock && !vessel?.isAtDock) {
      dockedTime = now.toMillis();
    }
    const data = {
      arrivingTerminalId: VesselData.ArrivingTerminalID,
      departingTerminalId: VesselData.DepartingTerminalID,
      departedTime,
      departureDelta,
      gpsDelay: gpsDelay ?? undefined,
      dockedTime,
      estimatedArrivalTime,
      heading: VesselData.Heading,
      id: String(VesselData.VesselID),
      isAtDock: VesselData.AtDock,
      location: {
        latitude: VesselData.Latitude,
        longitude: VesselData.Longitude,
      },
      mmsi: VesselData.Mmsi,
      speed: VesselData.Speed,
      info: {
        ...vessel?.info,
        crossing: VesselData.EtaBasis,
      },
    };
    if (vessel) {
      vessel.update(data);
    } else {
      [vessel] = Vessel.getOrCreate(String(VesselData.VesselID), data);
    }
    vessel.save();
  });
  logger.info(`Updated ${Object.keys(Vessel.getAll()).length} Vessel Statuses`);
};
