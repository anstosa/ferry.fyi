/**
 * Library for WSF APIs:
 * * https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html
 * * https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html
 * * https://www.wsdot.wa.gov/ferries/api/vessels/documentation/rest.html
 *
 * We wrap these APIs in order to orchestrate caching, proxy XML into a useful
 * format, and filter/rename the fields
 */

// imports
import {
  assign,
  cloneDeep,
  concat,
  each,
  filter,
  find,
  has,
  includes,
  indexOf,
  isEmpty,
  isNull,
  isUndefined,
  keyBy,
  keys,
  map,
  mean,
  merge,
  mergeWith,
  omit,
  round,
  setWith,
  sortBy,
  times,
  toNumber,
} from "lodash";
import { Camera, getCameras, MapPoint } from "./cameras";
import { DateTime } from "luxon";
import { getToday, wsfDateToTimestamp } from "./date";
import { Op } from "sequelize";
import Crossing from "../models/crossing";
import logger from "heroku-logger";
import request from "request-promise";
import sync from "aigle";

interface TerminalOverride {
  vesselwatch?: string;
  location?: {
    link: string;
  };
}

const TERMINAL_DATA_OVERRIDES: { [key: number]: TerminalOverride } = {
  1: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
  },
  3: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi",
  },
  4: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi",
  },
  5: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=mukcl",
    location: {
      link:
        "https://www.google.com/maps/place/Clinton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086",
    },
  },
  7: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi",
  },
  8: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=edking",
  },
  9: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs",
  },
  10: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
  },
  11: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptkey",
  },
  12: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=edking",
  },
  13: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
    location: {
      link:
        "https://www.google.com/maps/place/Lopez+Ferry+Landing/@48.5706056,-122.9007289,14z/data=!4m8!1m2!2m1!1slopez+island+ferry+terminal!3m4!1s0x548581184141c77d:0xb95765067fe72167!8m2!3d48.5706056!4d-122.8834068",
    },
  },
  14: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=mukcl",
  },
  15: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
    location: {
      link:
        "https://www.google.com/maps/place/Orcas+Island+Ferry+Terminal/@48.597361,-122.9458067,17z/data=!3m1!4b1!4m5!3m4!1s0x548587ff7781be87:0xb6eeeac287820785!8m2!3d48.597361!4d-122.9436127",
    },
  },
  16: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptdtal",
  },
  17: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptkey",
    location: {
      link:
        "https://www.google.com/maps/place/Port+Townsend+Terminal/@48.1121633,-122.7627137,17z/data=!3m1!4b1!4m5!3m4!1s0x548fedcf67a53163:0xd61a6301e962de31!8m2!3d48.1121633!4d-122.7605197",
    },
  },
  18: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
    location: {
      link:
        "https://www.google.com/maps/place/https://www.google.com/maps/place/Shaw+Island+Terminal/@48.584393,-122.9321401,17z/data=!3m1!4b1!4m5!3m4!1s0x548587290b11c709:0xb4bf5a7be8d73b0d!8m2!3d48.584393!4d-122.9299461linton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086",
    },
  },
  19: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
  },
  20: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs",
  },
  21: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptdtal",
  },
  22: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs",
  },
};

const VESSELWATCH_BASE =
  "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=";

const ESTIMATE_COMPOSITE_WEEKS = 6;

// API paths
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const API_SCHEDULE_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const apiScheduleMates = (): string =>
  `${API_SCHEDULE}/terminalsandmates/${getToday()}${API_ACCESS}`;
const apiScheduleRoute = (departingId: number, arrivingId: number): string =>
  `${API_SCHEDULE}/routedetails/` +
  `${getToday()}/${departingId}/${arrivingId}${API_ACCESS}`;

enum LoadingRules {
  Passenger = 1,
  Vehicle = 2,
  Both = 3,
}

export interface SailingTime {
  DepartingTime: string;
  ArrivingTime: string | null;
  LoadingRule: LoadingRules;
  VesselID: number;
  VesselName: string;
  VesselHandicapAccessible: boolean;
  Routes: number[];
  AnnotationIndexes: number[];
}

export interface Sailing {
  DepartingTerminalID: number;
  DepartingTerminalName: string;
  ArrivingTerminalID: number;
  ArrivingTerminalName: string;
  SailingNotes: string;
  Annotations: string[];
  AnnotationsIVR: string[];
  Times: SailingTime[];
}

export enum Seasons {
  Spring = 0,
  Summer = 1,
  Fall = 2,
  Winter = 3,
}

export interface ScheduleTodayReponse {
  ScheduleID: number;
  ScheduleName: string;
  ScheduleSeason: Seasons;
  SchedulePDFUrl: string;
  ScheduleStart: string;
  ScheduleEnd: string;
  AllRoutes: number[];
  TerminalCombos: Sailing[];
}
const apiScheduleToday = (departingId: number, arrivingId: number): string =>
  `${API_SCHEDULE}/scheduletoday/` +
  `${departingId}/${arrivingId}/false${API_ACCESS}`;

const API_VESSELS = "https://www.wsdot.wa.gov/ferries/api/vessels/rest";
const API_VESSELS_CACHE = `${API_VESSELS}/cacheflushdate`;
const API_VESSELS_LOCATIONS = `${API_VESSELS}/vessellocations${API_ACCESS}`;
const API_VESSELS_VERBOSE = `${API_VESSELS}/vesselverbose${API_ACCESS}`;

const API_TERMINALS = "https://www.wsdot.wa.gov/ferries/api/terminals/rest";
const API_TERMINALS_CACHE = `${API_TERMINALS}/cacheflushdate`;
const API_TERMINALS_SPACE = `${API_TERMINALS}/terminalsailingspace${API_ACCESS}`;
const API_TERMINALS_VERBOSE = `${API_TERMINALS}/terminalverbose${API_ACCESS}`;

// local state
type CachedTime = number;
const cacheFlushDates: { [key: string]: CachedTime } = {};

export interface Vessel {
  abbreviation: string;
  arrivingTerminalId?: number;
  departingTerminalId?: number;
  beam: number;
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
    ada: string;
    crossing?: string;
  };
  isAdaAccessible: boolean;
  isAtDock?: boolean;
  length: number;
  location?: MapPoint;
  maxClearance: number;
  mmsi?: string;
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

export interface Bulletin {
  title: string;
  description: string;
  date: number;
}

export interface WaitTime {
  title: string;
  description: string;
  time: number | null;
}

export interface Route {
  id: number;
  abbreviation: string;
  description: string;
  crossingTime: number;
}

export interface Terminal {
  abbreviation: string;
  bulletins: Bulletin[];
  cameras: Camera[];
  hasElevator: boolean;
  hasOverheadLoading: boolean;
  hasRestroom: boolean;
  hasWaitingRoom: boolean;
  hasFood: boolean;
  id: number;
  info: {
    ada: string;
    airport: string;
    bicycle: string;
    construction: string;
    food: string;
    lost: string;
    motorcycle: string;
    parking: string;
    security: string;
    train: string;
    truck: string;
  };
  location: {
    link: string;
    latitude: number;
    longitude: number;
    address: {
      line1: string;
      line2?: string | null;
      city: string;
      state: string;
      zip: string;
    };
  };
  name: string;
  waitTimes: WaitTime[];
  mates?: Terminal[];
  route?: Route;
  vesselwatch?: string;
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

export interface VesselsById {
  [vesselId: number]: Vessel;
}

export interface TerminalsById {
  [terminalId: number]: Terminal;
}

export interface Cache {
  vesselsById: VesselsById;
  estimates: {
    [departureId: number]: {
      [arrivalId: number]: {
        [wuid: string]: CrossingEstimate;
      };
    };
  };
  scheduleByTerminal: {
    [departureId: number]: {
      [arrivalId: number]: {
        [departureTime: number]: Slot;
      };
    };
  };
  terminalsById: TerminalsById;
  matesByTerminalId: { [terminalId: number]: number[] };
}

export const cache: Cache = {
  estimates: {},
  matesByTerminalId: {},
  scheduleByTerminal: {},
  terminalsById: {},
  vesselsById: {},
};

export const getSchedule = (
  departingId: number,
  arrivingId: number
): Slot[] => {
  const schedule = cache.scheduleByTerminal?.[departingId]?.[arrivingId];
  return sortBy(map(schedule), "time");
};

export const getVessels = (): VesselsById => cache.vesselsById;

export const getTerminals = (): TerminalsById => cache.terminalsById;

export const getTerminal = (id: number): Terminal => cache.terminalsById?.[id];

const {
  estimates,
  matesByTerminalId,
  scheduleByTerminal,
  terminalsById,
  vesselsById,
} = cache;

function addMate(id: number, mateId: number): void {
  if (has(matesByTerminalId, id)) {
    matesByTerminalId[id].push(mateId);
  } else {
    matesByTerminalId[id] = [mateId];
  }
}

// merge the given data into the vessel cache
function assignVessel(id: number, vessel: Partial<Vessel>): void {
  if (has(vesselsById, id)) {
    assign(vesselsById[id], vessel);
  } else {
    vesselsById[id] = vessel as Vessel;
  }
}

// merge the given data into the terminal cache
function assignTerminal(id: number, terminal: Partial<Terminal>): void {
  if (has(terminalsById, id)) {
    assign(terminalsById[id], terminal);
  } else {
    terminalsById[id] = terminal as Terminal;
  }
  merge(terminalsById[id], TERMINAL_DATA_OVERRIDES[id]);
}

// fetches mates from the cache
const getMates = (): any => matesByTerminalId;

// fetches a vessel from the cache
export const getVessel = (id: number, resetDelay = false): Vessel => {
  const vessel = cloneDeep(vesselsById[id]);
  if (resetDelay) {
    merge(vessel, { departureDelta: null });
  }
  return vessel;
};

const hasPassed = (crossing: Crossing): boolean => {
  if (!crossing) {
    return false;
  }
  const { departureTime, departureDelta } = crossing;
  let estimatedTime = DateTime.fromSeconds(departureTime);
  if (departureDelta) {
    estimatedTime = estimatedTime.plus({
      seconds: departureDelta,
    });
  }
  const now = DateTime.local();
  const hasPassed = estimatedTime < now;
  return hasPassed;
};

const backfillCrossings = async (): Promise<void> => {
  const yesterday = round(DateTime.local().minus({ days: 1 }).toSeconds());
  const crossings = await Crossing.findAll({
    where: { departureTime: { [Op.gt]: yesterday } },
  });
  each(crossings, (crossing) => {
    const { departureId, arrivalId, departureTime } = crossing;
    const slot =
      scheduleByTerminal?.[departureId]?.[arrivalId]?.[departureTime];
    if (slot) {
      slot.crossing = crossing;
    }
  });
};

// "Weekly Unique Identifier"
// Accepts a timestamp from a scheduled sailing
// Generates a key for use in comparing a sailing slot across weeks.
function getWuid(departureTime: number): string {
  return DateTime.fromSeconds(departureTime).toFormat("CCC-HH-mm");
}

const buildEstimates = async (
  departureId: number,
  arrivalId: number,
  schedule?: Slot[]
): Promise<void> => {
  if (isUndefined(schedule) || isEmpty(schedule)) {
    return;
  }
  const firstTime = schedule[0]?.time;
  const startTime = DateTime.fromSeconds(firstTime)
    .minus({ weeks: ESTIMATE_COMPOSITE_WEEKS })
    .toSeconds();
  const crossings = await Crossing.findAll({
    where: {
      departureId,
      arrivalId,
      departureTime: { [Op.gte]: startTime },
    },
  });
  each(schedule, (crossing) => {
    const { wuid } = crossing;
    const estimate: { [key: string]: number | null } = {};
    const data: { [key: string]: any[] } = {
      driveUpCapacity: [],
      reservableCapacity: [],
    };
    times(ESTIMATE_COMPOSITE_WEEKS, (index) => {
      const departureTime = DateTime.fromSeconds(crossing.time)
        .minus({ weeks: index + 1 })
        .toSeconds();
      const slot = find(crossings, { departureTime });
      if (isUndefined(slot)) {
        return;
      }
      const { driveUpCapacity, reservableCapacity } = slot;
      const dataPoint: CrossingEstimate = {
        driveUpCapacity,
        reservableCapacity,
      };
      mergeWith(data, dataPoint, (array, value) => concat(array, value));
    });
    each(data, (records, key) => {
      estimate[key] = round(mean(filter(records)));
    });
    setWith(estimates, [departureId, arrivalId, wuid], estimate, Object);
  });
};

const updateSchedule = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await request(API_SCHEDULE_CACHE, { json: true })
  );
  if (cacheFlushDate === cacheFlushDates.schedule) {
    logger.info("Skipped Schedule API Update");
    return;
  } else {
    logger.info("Started Schedule API Update");
  }
  cacheFlushDates.schedule = cacheFlushDate;
  logger.info("Started Mates Update");
  const mates = await request(apiScheduleMates(), { json: true });
  each(keys(matesByTerminalId), (key) => {
    delete matesByTerminalId[toNumber(key)];
  });
  each(mates, ({ DepartingTerminalID, ArrivingTerminalID }) =>
    addMate(DepartingTerminalID, ArrivingTerminalID)
  );
  logger.info("Completed Mates Update");
  logger.info("Started Schedule Update");
  await sync.each(matesByTerminalId, (mates, terminalId) =>
    sync.each(mates, async (mateId) => {
      const {
        TerminalCombos: [{ Times }],
      }: ScheduleTodayReponse = await request(
        apiScheduleToday(toNumber(terminalId), mateId),
        { json: true }
      );
      const seenVessels: number[] = [];

      const schedule = filter(
        map(Times, ({ DepartingTime, VesselID, LoadingRule }) => {
          const time = wsfDateToTimestamp(DepartingTime);
          if (isNull(time)) {
            return null;
          }
          const departureTime = DateTime.fromSeconds(time);
          const isFirstOfVessel = !includes(seenVessels, VesselID);
          const vessel = getVessel(VesselID, isFirstOfVessel);
          if (isFirstOfVessel) {
            seenVessels.push(VesselID);
          }
          return {
            allowsPassengers: includes(
              [LoadingRules.Passenger, LoadingRules.Both],
              LoadingRule
            ),
            allowsVehicles: includes(
              [LoadingRules.Vehicle, LoadingRules.Both],
              LoadingRule
            ),
            hasPassed: departureTime < DateTime.local(),
            wuid: getWuid(time),
            time,
            vessel,
          };
        })
      ) as Slot[];

      setWith(
        scheduleByTerminal,
        [terminalId, mateId],
        keyBy(schedule, "time"),
        Object
      );
      await buildEstimates(toNumber(terminalId), mateId, schedule);
    })
  );
  logger.info("Completed Schedule Update");
  logger.info("Completed Schedule API Update");
  await backfillCrossings();
};

const updateVessels = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await request(API_VESSELS_CACHE, { json: true })
  );
  if (cacheFlushDate === cacheFlushDates.vessels) {
    logger.info("Skipped Vessel Update");
    return;
  } else {
    logger.info("Started Vessel Update");
  }
  cacheFlushDates.vessels = cacheFlushDate;

  const vessels = await request(API_VESSELS_VERBOSE, { json: true });
  each(vessels, (vessel) => {
    const {
      ADAAccessible,
      ADAInfo,
      Beam,
      CarDeckRestroom,
      Class: { ClassID },
      Elevator,
      Horsepower,
      Length,
      MainCabinGalley,
      MainCabinRestroom,
      MaxPassengerCount,
      PublicWifi,
      RegDeckSpace,
      SpeedInKnots,
      TallDeckClearance,
      TallDeckSpace,
      Tonnage,
      VesselAbbrev,
      VesselID,
      VesselName,
      YearBuilt,
      YearRebuilt,
      status,
    } = vessel;

    assignVessel(VesselID, {
      abbreviation: VesselAbbrev,
      beam: Beam,
      classId: ClassID,
      hasCarDeckRestroom: CarDeckRestroom,
      hasElevator: Elevator,
      hasGalley: MainCabinGalley,
      hasRestroom: CarDeckRestroom || MainCabinRestroom,
      hasWiFi: PublicWifi,
      horsepower: Horsepower,
      id: VesselID,
      inMaintenance: status === 2,
      inService: status === 1,
      info: {
        ada: ADAInfo,
      },
      isAdaAccessible: ADAAccessible,
      length: Length,
      maxClearance: TallDeckClearance,
      name: VesselName,
      passengerCapacity: MaxPassengerCount,
      speed: SpeedInKnots,
      tallVehicleCapacity: TallDeckSpace,
      vesselwatch: `${VESSELWATCH_BASE}${VesselName}`,
      vehicleCapacity: RegDeckSpace + TallDeckSpace,
      weight: Tonnage,
      yearBuilt: YearBuilt,
      yearRebuilt: YearRebuilt,
    });
  });
  logger.info("Completed Vessel Update");
};

export const updateTerminals = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await request(API_TERMINALS_CACHE, { json: true })
  );
  if (cacheFlushDate === cacheFlushDates.terminals) {
    logger.info("Skipped Terminal Update");
    return;
  } else {
    logger.info("Started Terminal Update");
  }
  cacheFlushDates.terminals = cacheFlushDate;

  const terminals = await request(API_TERMINALS_VERBOSE, { json: true });
  each(terminals, (terminal) => {
    const {
      AdaInfo,
      AddressLineOne,
      AddressLineTwo,
      AirportInfo,
      AirportShuttleInfo,
      BikeInfo,
      Bulletins,
      City,
      ConstructionInfo,
      Elevator,
      FoodService,
      FoodServiceInfo,
      Latitude,
      Longitude,
      LostAndFoundInfo,
      MapLink,
      MotorcycleInfo,
      OverheadPassengerLoading,
      ParkingInfo,
      ParkingShuttleInfo,
      Restroom,
      SecurityInfo,
      State,
      TerminalAbbrev,
      TerminalID,
      TerminalName,
      TrainInfo,
      TruckInfo,
      WaitTimes,
      WaitingRoom,
      ZipCode,
    } = terminal;

    assignTerminal(TerminalID, {
      abbreviation: TerminalAbbrev,
      bulletins: map(
        Bulletins,
        ({ BulletinTitle, BulletinText, BulletinLastUpdated }) => ({
          title: BulletinTitle,
          description: BulletinText,
          date: wsfDateToTimestamp(BulletinLastUpdated),
        })
      ),
      cameras: getCameras(TerminalID),
      hasElevator: Elevator,
      hasOverheadLoading: OverheadPassengerLoading,
      hasRestroom: Restroom,
      hasWaitingRoom: WaitingRoom,
      hasFood: FoodService,
      id: TerminalID,
      info: {
        ada: AdaInfo,
        airport: AirportInfo + AirportShuttleInfo,
        bicycle: BikeInfo,
        construction: ConstructionInfo,
        food: FoodServiceInfo,
        lost: LostAndFoundInfo,
        motorcycle: MotorcycleInfo,
        parking: ParkingInfo + ParkingShuttleInfo,
        security: SecurityInfo,
        train: TrainInfo,
        truck: TruckInfo,
      },
      location: {
        link: MapLink,
        latitude: Latitude,
        longitude: Longitude,
        address: {
          line1: AddressLineOne,
          line2: AddressLineTwo,
          city: City,
          state: State,
          zip: ZipCode,
        },
      },
      name: TerminalName,
      waitTimes: map(
        WaitTimes,
        ({ RouteName, WaitTimeNotes, WaitTimeLastUpdated }) => ({
          title: RouteName,
          description: WaitTimeNotes,
          time: wsfDateToTimestamp(WaitTimeLastUpdated),
        })
      ),
    });
  });
  const matesByTerminalId = await getMates();
  await sync.each(matesByTerminalId, async (mates, terminalId) => {
    const matesWithRoute: Terminal[] = [];
    await sync.each(mates, async (mateId) => {
      const mate = cloneDeep(omit(terminalsById[mateId], "mates"));
      const [route] = await request(
        apiScheduleRoute(toNumber(terminalId), mateId),
        { json: true }
      );
      mate.route = {
        id: route.RouteID,
        abbreviation: route.RouteAbbrev,
        description: route.Description,
        crossingTime: toNumber(route.CrossingTime),
      };
      matesWithRoute.push(mate);
    });
    assignTerminal(toNumber(terminalId), { mates: matesWithRoute });
  });

  logger.info("Completed Terminal Update");
};

// set cache with all long-lived data from API
export const updateLong = async (): Promise<void> => {
  await updateVessels();
  await updateSchedule();
  await updateTerminals();
};

const updateTiming = async (): Promise<any> => {
  logger.info("Started Timing Update");
  const vessels = await request(API_VESSELS_LOCATIONS, {
    json: true,
  });
  each(vessels, (vessel) => {
    const {
      VesselID,
      LeftDock,
      ScheduledDeparture,
      Eta,
      ArrivingTerminalID,
      DepartingTerminalID,
      Heading,
      AtDock,
      Latitude,
      Longitude,
      Mmsi,
      Speed,
      EtaBasis,
    } = vessel;
    const departedTime = wsfDateToTimestamp(LeftDock);
    const departureTime = wsfDateToTimestamp(ScheduledDeparture);
    const estimatedArrivalTime = wsfDateToTimestamp(Eta);
    let departureDelta: number | undefined;
    if (departureTime && departedTime) {
      departureDelta = departedTime - departureTime;
    } else {
      departureDelta = vesselsById?.[VesselID]?.departureDelta;
    }
    const previousVessel = vesselsById[VesselID];
    let dockedTime: number | undefined;
    if (AtDock && !previousVessel?.isAtDock) {
      dockedTime = DateTime.local().toMillis();
    }
    assignVessel(VesselID, {
      arrivingTerminalId: ArrivingTerminalID,
      departingTerminalId: DepartingTerminalID,
      departedTime,
      departureDelta,
      dockedTime,
      estimatedArrivalTime,
      heading: Heading,
      id: VesselID,
      isAtDock: AtDock,
      location: {
        latitude: Latitude,
        longitude: Longitude,
      },
      mmsi: Mmsi,
      speed: Speed,
      info: {
        ...vesselsById[VesselID]?.info,
        crossing: EtaBasis,
      },
    });
  });
  const now = DateTime.local();
  sync.each(scheduleByTerminal, (mates) =>
    sync.each(mates, (schedule) => {
      const seenVessels: number[] = [];
      sync.each(schedule, (slot) => {
        const vesselId = slot.vessel.id;
        const isFirstOfVessel = !includes(seenVessels, vesselId);
        const vessel = getVessel(vesselId, isFirstOfVessel);
        if (isFirstOfVessel) {
          seenVessels.push(vesselId);
        }
        slot.vessel = vessel;
        const { crossing, time } = slot;
        if (crossing) {
          slot.hasPassed = hasPassed(crossing);
        } else {
          slot.hasPassed = DateTime.fromSeconds(time) < now;
        }
      });
    })
  );
  logger.info("Completed Timing Update");
};

const getPreviousCrossing = (
  departureId: number,
  arrivalId: number,
  departureTime: number
): Crossing | null => {
  const schedule = scheduleByTerminal?.[departureId]?.[arrivalId];
  const departureTimes = sortBy((keys(schedule) as unknown) as number[]);
  const departureIndex = indexOf(departureTimes, departureTime);
  if (departureIndex === 0) {
    return null;
  } else {
    const previousDepartureTime = departureTimes[departureIndex - 1];
    const previousCapacity = schedule?.[previousDepartureTime]?.crossing;
    return previousCapacity || null;
  }
};

const isCrossingEmpty = (crossing: Crossing): boolean => {
  const { driveUpCapacity, reservableCapacity, totalCapacity } = crossing;
  return driveUpCapacity + reservableCapacity === totalCapacity;
};

const isCrossingFull = (crossing: Crossing): boolean => {
  const { driveUpCapacity, reservableCapacity } = crossing;
  return driveUpCapacity === 0 && reservableCapacity === 0;
};

const updateCapacity = async (): Promise<void> => {
  logger.info("Started Capacity Update");
  const terminals = await request(API_TERMINALS_SPACE, { json: true });
  await sync.each(terminals, async (terminal) => {
    const { TerminalID } = terminal;
    await sync.each(terminal.DepartingSpaces, async (departure) => {
      const { VesselID, Departure } = departure;
      await sync.each(departure.SpaceForArrivalTerminals, async (spaceData) => {
        const {
          ArrivalTerminalIDs,
          DriveUpSpaceCount,
          DisplayDriveUpSpace,
          DisplayReservableSpace,
          IsCancelled,
          ReservableSpaceCount,
          MaxSpaceCount,
        } = spaceData;
        const vessel = vesselsById?.[VesselID];
        const departureTime = wsfDateToTimestamp(Departure);
        await sync.each(ArrivalTerminalIDs, async (arrivalId) => {
          const model: Partial<Crossing> = {
            arrivalId,
            departureId: TerminalID,
            departureDelta: vessel?.departureDelta || null,
            departureTime,
            driveUpCapacity: DriveUpSpaceCount,
            hasDriveUp: DisplayDriveUpSpace,
            hasReservations: DisplayReservableSpace,
            isCancelled: IsCancelled,
            reservableCapacity: ReservableSpaceCount,
            totalCapacity: MaxSpaceCount,
          };
          const where = { arrivalId, departureId: TerminalID, departureTime };
          const [crossing, wasCreated] = await Crossing.findOrCreate({
            where,
            defaults: model,
          });
          if (!wasCreated) {
            await crossing.update(model);
          }
          const slot =
            scheduleByTerminal?.[TerminalID]?.[arrivalId]?.[departureTime];
          if (slot) {
            slot.crossing = crossing;
          }

          // Because of how WSF reports data, if the previous run is running so
          // behind, it's scheduled to leave after the next run was scheduled,
          // they'll stop reporting real-time data against it. So if the next run not
          // empty, report the previous run as full.
          const previousCrossing = await getPreviousCrossing(
            TerminalID,
            arrivalId,
            departureTime
          );
          if (
            previousCrossing &&
            !hasPassed(previousCrossing) &&
            !isCrossingFull(previousCrossing) &&
            !isCrossingEmpty(crossing)
          ) {
            await previousCrossing.update({
              driveUpCapacity: 0,
              reservableCapacity: 0,
            });
          }
        });
      });
    });
  });
  logger.info("Completed Capacity Update");
};

const updateEstimates = (): void => {
  each(scheduleByTerminal, (mates, departureId) =>
    each(mates, (schedule, mateId) =>
      each(schedule, (slot) => {
        const estimate =
          estimates?.[toNumber(departureId)]?.[toNumber(mateId)]?.[
            getWuid(slot.time)
          ];
        if (!estimate) {
          return;
        }
        slot.estimate = estimate;
      })
    )
  );
  logger.info("Updated Estimates");
};

export const updateShort = async (): Promise<void> => {
  await updateTiming();
  await updateCapacity();
  updateEstimates();
};
