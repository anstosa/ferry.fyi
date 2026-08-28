import logger from "heroku-logger";
import { DateTime } from "luxon";
import VESSEL_DATA_OVERRIDES from "shared/data/vessels.json";
import { values } from "shared/lib/objects";

import {
  formatLogBlock,
  formatTerminalList,
  formatVesselList,
} from "~/lib/logging";
import { calculateGpsDelayForLeg, findGpsDelayLeg } from "~/lib/wsf/gpsDelay";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import {
  ingestLeaderboardVesselStatusRefresh,
  pruneLeaderboardVesselVerificationSnapshots,
  recordSkippedLeaderboardVesselStatusRefresh,
} from "~/services/leaderboardVesselSnapshotIngestion";
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

// isolate snapshot pruning from public refreshes
const pruneLeaderboardVesselHistory = async (nowMs: number): Promise<void> => {
  // keep refreshes resilient to unexpected prune failures
  try {
    await pruneLeaderboardVesselVerificationSnapshots({ nowMs });
  } catch {
    logger.info("Leaderboard vessel snapshot prune failed");
  }
};

// update vessel metadata
export const updateVessels = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  // fresh cache guard
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped vessel metadata update; cache flush unchanged");
    return;
  } else {
    logger.info(
      `Started vessel metadata update; cache flush ${cacheFlushDate}`
    );
  }
  const vessels = await wsfRequest<WSF.VesselsVerboseResponse[]>(API_VERBOSE);
  // missing vessels guard
  if (!vessels?.length) {
    logger.info("Skipped vessel metadata update; WSF returned no vessels");
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
    // created vessel guard
    if (wasCreated) {
      vessel.save();
      return;
    }
    vessel.update(data);
    vessel.save();
  });
  logger.info(
    formatLogBlock("Vessel metadata update complete", [
      {
        heading: "summary",
        lines: [`vessels: ${Object.keys(Vessel.getAll()).length}`],
      },
      {
        heading: "refreshed vessels",
        // list refreshed public ids
        lines: formatVesselList(vessels.map((vessel) => vessel.VesselID)),
      },
    ])
  );
  // refresh calls are serialized by updateLong
  // eslint-disable-next-line require-atomic-updates
  lastFlushDate = cacheFlushDate;
};

// refresh hydrated vessel status
export const updateVesselStatus = async (): Promise<any> => {
  logger.info("Started vessel status update");
  const vessels =
    await wsfRequest<WSF.VesselsLocationResponse[]>(API_LOCATIONS);
  const receivedAtMs = Date.now();
  // missing vessels guard
  if (!vessels) {
    recordSkippedLeaderboardVesselStatusRefresh(receivedAtMs);
    await pruneLeaderboardVesselHistory(receivedAtMs);
    logger.info("Skipped vessel status update; WSF returned no vessels");
    return;
  }
  const schedules = values(Schedule.getAll());
  const terminals = values(Terminal.getAll());
  const now = DateTime.fromMillis(receivedAtMs);
  let skippedVessels = 0;
  let updatedVessels = 0;
  let vesselsAtDock = 0;
  // hydrate each public vessel status
  vessels.forEach((VesselData) => {
    const vessel = Vessel.getByIndex(String(VesselData.VesselID));
    // require vessel metadata
    if (!vessel) {
      skippedVessels += 1;
      return;
    }
    const { departureDelta: previousDepartureDelta } = vessel;
    const departedTime = wsfDateToTimestamp(VesselData.LeftDock);
    const departureTime = wsfDateToTimestamp(VesselData.ScheduledDeparture);
    const estimatedArrivalTime = wsfDateToTimestamp(VesselData.Eta);
    let departureDelta: number | undefined;
    // dock event delay
    if (departureTime && departedTime) {
      departureDelta = departedTime - departureTime;
    } else {
      departureDelta = previousDepartureDelta;
    }
    const gpsDelayLeg = findGpsDelayLeg({
      arrivalTerminalId: VesselData.ArrivingTerminalID,
      departureTerminalId: VesselData.DepartingTerminalID,
      scheduledDepartureTime: departureTime,
      schedules,
      terminals,
      vesselId: String(VesselData.VesselID),
    });
    // calculate dock delay
    const dockDelaySeconds =
      departureTime && departedTime ? departedTime - departureTime : null;
    // calculate eta delay
    const etaDelaySeconds =
      gpsDelayLeg && estimatedArrivalTime
        ? estimatedArrivalTime - gpsDelayLeg.scheduledArrivalTime
        : null;
    // calculate gps delay
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
    // newly docked guard
    if (VesselData.AtDock && !vessel.isAtDock) {
      dockedTime = now.toMillis();
    }
    const data = {
      arrivingTerminalId: VesselData.ArrivingTerminalID,
      departingTerminalId: VesselData.DepartingTerminalID,
      departedTime,
      departureDelta,
      scheduledDepartureTime: departureTime,
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
      statusUpdatedAt: receivedAtMs,
      info: {
        ...vessel.info,
        crossing: VesselData.EtaBasis,
      },
    };
    vessel.update(data);
    updatedVessels += 1;
    // docked vessel guard
    if (VesselData.AtDock) {
      vesselsAtDock += 1;
    }
    vessel.save();
  });
  // persist aggregate-verifiable public observations
  await ingestLeaderboardVesselStatusRefresh(vessels, { receivedAtMs });
  // enforce retained-history lifecycle
  await pruneLeaderboardVesselHistory(receivedAtMs);
  // aggregate public route origins
  const departingTerminalIds = Array.from(
    // collect each route origin
    new Set(vessels.map((vessel) => vessel.DepartingTerminalID))
  );
  logger.info(
    formatLogBlock("Vessel status update complete", [
      {
        heading: "summary",
        lines: [
          `updated vessels: ${updatedVessels}`,
          `skipped vessels: ${skippedVessels}`,
          `at dock: ${vesselsAtDock}`,
          `underway: ${updatedVessels - vesselsAtDock}`,
        ],
      },
      {
        heading: "departing terminals",
        lines: formatTerminalList(departingTerminalIds),
      },
    ])
  );
};
