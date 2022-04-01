import { Bulletin } from "~/models/Bulletin";
import { Camera } from "~/models/Camera";
import { Route } from "~/models/Route";
import { sortBy } from "shared/lib/arrays";
import { Terminal } from "~/models/Terminal";
import { WSF } from "~/typings/wsf";
import { wsfDateToTimestamp } from "./date";
import { wsfRequest } from "./api";
import logger from "heroku-logger";

const VESSELWATCH_BASE =
  "https://wsdot.com/ferries/vesselwatch/terminaldetail.aspx?terminalid=";
export const API_TERMINALS =
  "https://www.wsdot.wa.gov/ferries/api/terminals/rest";
const API_CACHE = `${API_TERMINALS}/cacheflushdate`;
const API_VERBOSE = `${API_TERMINALS}/terminalverbose`;

let lastFlushDate: number | null = null;

const ALERT_FILTER = new RegExp(
  `(${[
    "boat",
    "alternate",
    "advised",
    "cancelled",
    "emergency",
    "medical",
    "police",
    "tide",
    "traffic",
    "hour wait",
    "hr wait",
    "minute wait",
    "min wait",
    "without traffic",
  ].join("|")})`,
  "i"
);

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

  const terminals = await wsfRequest<WSF.TerminalVerboseResponse[]>(
    API_VERBOSE
  );
  if (!terminals) {
    return;
  }
  terminals
    .map((TerminalData) => {
      const data = {
        abbreviation: TerminalData.TerminalAbbrev,
        bulletins: TerminalData.Bulletins.map(
          ({ BulletinTitle, BulletinText, BulletinLastUpdated }) => {
            // don't process stupid bulletins
            if (!ALERT_FILTER.test(BulletinTitle)) {
              return;
            }
            const data = {
              title: BulletinTitle,
              terminalId: String(TerminalData.TerminalID),
              bodyHTML: BulletinText,
              date: wsfDateToTimestamp(BulletinLastUpdated),
              url: `${process.env.BASE_URL}/${String(
                TerminalData.TerminalID
              )}/alerts`,
            };
            const [bulletin] = Bulletin.getOrCreate(
              Bulletin.generateIndex(data),
              data
            );
            return bulletin;
          }
        ).filter(Boolean),
        cameras: sortBy(
          Camera.getByTerminalId(String(TerminalData.TerminalID)),
          "orderFromTerminal"
        ),
        hasElevator: TerminalData.Elevator,
        hasOverheadLoading: TerminalData.OverheadPassengerLoading,
        hasRestroom: TerminalData.Restroom,
        hasWaitingRoom: TerminalData.WaitingRoom,
        hasFood: TerminalData.FoodService,
        id: String(TerminalData.TerminalID),
        info: {
          ada: TerminalData.AdaInfo,
          airport:
            (TerminalData.AirportInfo ?? "") +
            (TerminalData.AirportShuttleInfo ?? ""),
          bicycle: TerminalData.BikeInfo,
          construction: TerminalData.ConstructionInfo,
          food: TerminalData.FoodServiceInfo,
          lost: TerminalData.LostAndFoundInfo,
          motorcycle: TerminalData.MotorcycleInfo,
          parking:
            (TerminalData.ParkingInfo ?? "") +
            (TerminalData.ParkingShuttleInfo ?? ""),
          security: TerminalData.SecurityInfo,
          train: TerminalData.TrainInfo,
          truck: TerminalData.TruckInfo,
        },
        location: {
          link: TerminalData.MapLink,
          latitude: TerminalData.Latitude,
          longitude: TerminalData.Longitude,
          address: {
            line1: TerminalData.AddressLineOne,
            line2: TerminalData.AddressLineTwo,
            city: TerminalData.City,
            state: TerminalData.State,
            zip: TerminalData.ZipCode,
          },
        },
        name: TerminalData.TerminalName,
        waitTimes: TerminalData.WaitTimes.map(
          ({ RouteName, WaitTimeNotes, WaitTimeLastUpdated }) => ({
            title: RouteName,
            description: WaitTimeNotes,
            time: wsfDateToTimestamp(WaitTimeLastUpdated),
          })
        ),
        terminalUrl: `${VESSELWATCH_BASE}${String(TerminalData.TerminalID)}`,
      };

      const [terminal, wasCreated] = Terminal.getOrCreate(
        String(TerminalData.TerminalID),
        data
      );
      if (!wasCreated) {
        terminal.update(data);
      }
      terminal.save();
      return terminal;
    })
    .forEach((terminal) => {
      // setting routes depends on all the terminals already being cached
      terminal.update({
        mates: Route.getMatesByTerminalId(terminal.id),
        routes: Route.getByTerminalId(terminal.id),
      });
      terminal.save();
    });

  logger.info(`Updated ${Object.keys(Terminal.getAll()).length} Terminals`);
};
