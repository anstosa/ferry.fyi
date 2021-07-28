/**
 * Library for WSF APIs:
 * * https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html
 *
 * We wrap these APIs in order to orchestrate caching, proxy XML into a useful
 * format, and filter/rename the fields
 */

// imports

import { assign, cloneDeep, each, has, map, omit, toNumber } from "lodash";
import { getCameras } from "./cameras";
import { getMates, getRoute } from "./schedule";
import { Terminal } from "shared/models/terminals";
import { wsfDateToTimestamp } from "./date";
import { wsfRequest } from "./api";
import logger from "heroku-logger";
import sync from "aigle";

// types

interface TerminalOverride {
  vesselwatch?: string;
  location?: {
    link: string;
  };
}

interface TerminalGISResponse {
  ZoomLevel: number;
  Latitude?: number;
  Longitude?: number;
}

interface TerminalTransitLinkReponse {
  LinkURL: string;
  LinkName: string;
  SortSeq?: number;
}

interface TerminalWaitReponse {
  RouteID?: number;
  RouteName?: string;
  WaitTimeNotes: string;
  WaitTimeLastUpdated?: string;
}

interface TerminalVisitorLinkResponse {
  LinkURL: string;
  LinkName: string;
  SortSeq?: number;
}

interface TerminalBulletinResponse {
  BulletinTitle: string;
  BulletinText: string;
  BulletinSortSeq: number;
  BulletinLastUpdated?: string;
  BulletinLastUpdatedSortable?: string;
}

interface TerminalVerboseResponse {
  TerminalID: number;
  TerminalSubjectID: number;
  RegionID: number;
  TerminalName: string;
  TerminalAbbrev: string;
  SortSeq: number;
  OverheadPassengerLoading: boolean;
  Elevator: boolean;
  WaitingRoom: boolean;
  FoodService: boolean;
  Restroom: boolean;
  Latitude?: number;
  Longitude?: number;
  AddressLineOne?: string;
  AddressLineTwo?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  Country?: string;
  MapLink?: string;
  Directions?: string;
  DispGISZoomLoc: TerminalGISResponse[];
  ParkingInfo?: string;
  ParkingShuttleInfo?: string;
  AirportInfo?: string;
  AirportShuttleInfo?: string;
  MotorcycleInfo?: string;
  TruckInfo?: string;
  BikeInfo?: string;
  TrainInfo?: string;
  TaxiInfo?: string;
  HovInfo?: string;
  TransitLinks: TerminalTransitLinkReponse[];
  WaitTimes: TerminalWaitReponse[];
  AdditionalInfo?: string;
  LostAndFoundInfo?: string;
  SecurityInfo?: string;
  ConstructionInfo?: string;
  FoodServiceInfo?: string;
  AdaInfo?: string;
  FareDiscountInfo?: string;
  TallySystemInfo?: string;
  ChamberOfCommerce?: {
    LinkURL: string;
    LinkName: string;
    SortSeq?: number;
  };
  FacInfo?: string;
  ResourceStatus?: string;
  TypeDesc?: string;
  REALTIME_SHUTOFF_FLAG: boolean;
  REALTIME_SHUTOFF_MESSAGE?: string;
  VisitorLinks: TerminalVisitorLinkResponse[];
  Bulletins: TerminalBulletinResponse[];
  IsNoFareCollected?: boolean;
  NoFareCollectedMsg?: string;
  RealtimeIntroMsg?: string;
}

interface ArrivalSpaceResponse {
  TerminalID: number;
  TerminalName: string;
  VesselID: number;
  VesselName: string;
  DisplayReservableSpace: boolean;
  ReservableSpaceCount?: number;
  ReservableSpaceHexColor?: string;
  DisplayDriveUpSpace: boolean;
  DriveUpSpaceCount?: number;
  DriveUpSpaceHexColor?: string;
  MaxSpaceCount: number;
  ArrivalTerminalIDs: number[];
}

interface DepartureSpaceResponse {
  Departure: string;
  IsCancelled: boolean;
  VesselID: number;
  MaxSpaceCount: number;
  SpaceForArrivalTerminals: ArrivalSpaceResponse[];
}

interface SpaceResponse {
  TerminalID: number;
  TerminalSubjectID: number;
  RegionID: number;
  TerminalName: string;
  TerminalAbbrev: string;
  SortSeq: number;
  DepartingSpaces: DepartureSpaceResponse[];
  IsNoFareCollected?: boolean;
  NoFareCollectedMsg?: string;
}

const TERMINAL_DATA_OVERRIDES: Record<number, TerminalOverride> = {
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
      link: "https://www.google.com/maps/place/Clinton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086",
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
      link: "https://www.google.com/maps/place/Lopez+Ferry+Landing/@48.5706056,-122.9007289,14z/data=!4m8!1m2!2m1!1slopez+island+ferry+terminal!3m4!1s0x548581184141c77d:0xb95765067fe72167!8m2!3d48.5706056!4d-122.8834068",
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
      link: "https://www.google.com/maps/place/Orcas+Island+Ferry+Terminal/@48.597361,-122.9458067,17z/data=!3m1!4b1!4m5!3m4!1s0x548587ff7781be87:0xb6eeeac287820785!8m2!3d48.597361!4d-122.9436127",
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
      link: "https://www.google.com/maps/place/Port+Townsend+Terminal/@48.1121633,-122.7627137,17z/data=!3m1!4b1!4m5!3m4!1s0x548fedcf67a53163:0xd61a6301e962de31!8m2!3d48.1121633!4d-122.7605197",
    },
  },
  18: {
    vesselwatch:
      "https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid",
    location: {
      link: "https://www.google.com/maps/place/https://www.google.com/maps/place/Shaw+Island+Terminal/@48.584393,-122.9321401,17z/data=!3m1!4b1!4m5!3m4!1s0x548587290b11c709:0xb4bf5a7be8d73b0d!8m2!3d48.584393!4d-122.9299461linton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086",
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

// API paths

const API_TERMINALS = "https://www.wsdot.wa.gov/ferries/api/terminals/rest";
const API_CACHE = `${API_TERMINALS}/cacheflushdate`;
const API_SPACE = `${API_TERMINALS}/terminalsailingspace`;
const API_VERBOSE = `${API_TERMINALS}/terminalverbose`;

// local state

let lastFlushDate: number | null = null;

const terminalsById: Record<number, Terminal> = {};

// local functions

function assignTerminal(id: number, terminal: Partial<Terminal>): void {
  if (has(terminalsById, id)) {
    assign(terminalsById[id], { ...terminal, ...TERMINAL_DATA_OVERRIDES[id] });
  } else {
    terminalsById[id] = {
      ...terminal,
      ...TERMINAL_DATA_OVERRIDES[id],
    } as Terminal;
  }
}

// exported functions

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getTerminals = () => terminalsById;

export const getTerminal = (id: number): Terminal => terminalsById?.[id];

export const getCapacity = async (): Promise<SpaceResponse[] | undefined> =>
  await wsfRequest<SpaceResponse[]>(API_SPACE);

export const updateTerminals = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped Terminal Update");
    return;
  } else {
    logger.info("Started Terminal Update");
  }
  lastFlushDate = cacheFlushDate;

  const terminals = await wsfRequest<TerminalVerboseResponse[]>(API_VERBOSE);
  if (!terminals) {
    return;
  }
  each(terminals, (terminal) => {
    assignTerminal(terminal.TerminalID, {
      abbreviation: terminal.TerminalAbbrev,
      bulletins: map(
        terminal.Bulletins,
        ({ BulletinTitle, BulletinText, BulletinLastUpdated }) => ({
          title: BulletinTitle,
          description: BulletinText,
          date: wsfDateToTimestamp(BulletinLastUpdated),
        })
      ),
      cameras: getCameras(terminal.TerminalID),
      hasElevator: terminal.Elevator,
      hasOverheadLoading: terminal.OverheadPassengerLoading,
      hasRestroom: terminal.Restroom,
      hasWaitingRoom: terminal.WaitingRoom,
      hasFood: terminal.FoodService,
      id: terminal.TerminalID,
      info: {
        ada: terminal.AdaInfo,
        airport:
          (terminal.AirportInfo ?? "") + (terminal.AirportShuttleInfo ?? ""),
        bicycle: terminal.BikeInfo,
        construction: terminal.ConstructionInfo,
        food: terminal.FoodServiceInfo,
        lost: terminal.LostAndFoundInfo,
        motorcycle: terminal.MotorcycleInfo,
        parking:
          (terminal.ParkingInfo ?? "") + (terminal.ParkingShuttleInfo ?? ""),
        security: terminal.SecurityInfo,
        train: terminal.TrainInfo,
        truck: terminal.TruckInfo,
      },
      location: {
        link: terminal.MapLink,
        latitude: terminal.Latitude,
        longitude: terminal.Longitude,
        address: {
          line1: terminal.AddressLineOne,
          line2: terminal.AddressLineTwo,
          city: terminal.City,
          state: terminal.State,
          zip: terminal.ZipCode,
        },
      },
      name: terminal.TerminalName,
      waitTimes: map(
        terminal.WaitTimes,
        ({ RouteName, WaitTimeNotes, WaitTimeLastUpdated }) => ({
          title: RouteName,
          description: WaitTimeNotes,
          time: wsfDateToTimestamp(WaitTimeLastUpdated),
        })
      ),
    });
  });
  await sync.each(getMates(), async (mates, terminalId) => {
    const matesWithRoute: Terminal[] = [];
    await sync.each(mates, async (mateId) => {
      const mate = cloneDeep(omit(terminalsById[mateId], "mates"));
      mate.route = await getRoute(toNumber(terminalId), mateId);
      matesWithRoute.push(mate);
    });
    assignTerminal(toNumber(terminalId), { mates: matesWithRoute });
  });

  logger.info("Completed Terminal Update");
};
