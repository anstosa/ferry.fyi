import logger from "heroku-logger";

import { formatLogBlock, formatTerminalList } from "~/lib/logging";
import { Bulletin } from "~/models/Bulletin";
import { Camera } from "~/models/Camera";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { wsfDateToTimestamp } from "./date";
import {
  isRemovedTerminalId,
  purgeRemovedTerminalData,
} from "./removedTerminals";

const VESSELWATCH_BASE =
  "https://wsdot.com/ferries/vesselwatch/terminaldetail.aspx?terminalid=";
export const API_TERMINALS =
  "https://www.wsdot.wa.gov/ferries/api/terminals/rest";
const API_CACHE = `${API_TERMINALS}/cacheflushdate`;
const API_VERBOSE = `${API_TERMINALS}/terminalverbose`;

let lastFlushDate: number | null = null;

export const updateTerminals = async (): Promise<void> => {
  const cacheFlushDate = wsfDateToTimestamp(
    await wsfRequest<string>(API_CACHE)
  );
  // fresh cache guard
  if (cacheFlushDate === lastFlushDate) {
    logger.info("Skipped terminal update; cache flush unchanged");
    return;
  } else {
    logger.info(`Started terminal update; cache flush ${cacheFlushDate}`);
  }
  const terminals =
    await wsfRequest<WSF.TerminalVerboseResponse[]>(API_VERBOSE);
  // missing terminals guard
  if (!terminals) {
    logger.info("Skipped terminal update; WSF returned no terminals");
    return;
  }
  purgeRemovedTerminalData();
  const seenAt = Math.floor(Date.now() / 1000);
  const refreshedTerminals: Terminal[] = [];
  // terminal refresh
  for (const TerminalData of terminals.filter(
    ({ TerminalID }) => !isRemovedTerminalId(String(TerminalID))
  )) {
    const terminalId = String(TerminalData.TerminalID);
    const bulletins: Bulletin[] = [];
    // bulletin refresh
    for (const {
      BulletinTitle,
      BulletinText,
      BulletinLastUpdated,
    } of TerminalData.Bulletins) {
      const data = {
        title: BulletinTitle,
        terminalId,
        bodyHTML: BulletinText,
        date: wsfDateToTimestamp(BulletinLastUpdated),
        url: `${process.env.BASE_URL}/${terminalId}/alerts`,
      };
      const [bulletin] = Bulletin.getOrUpdate(
        Bulletin.generateIndex(data),
        data
      );
      await bulletin.persistActive(seenAt);
      bulletins.push(bulletin);
    }
    await Bulletin.markInactiveForTerminal(
      terminalId,
      bulletins.map((bulletin) => bulletin.id),
      seenAt
    );
    const data = {
      abbreviation: TerminalData.TerminalAbbrev,
      bulletins: Bulletin.sort(bulletins),
      cameras: Camera.sortByTerminalDisplayOrder(
        Camera.getByTerminalId(terminalId)
      ),
      hasElevator: TerminalData.Elevator,
      hasOverheadLoading: TerminalData.OverheadPassengerLoading,
      hasRestroom: TerminalData.Restroom,
      hasWaitingRoom: TerminalData.WaitingRoom,
      hasFood: TerminalData.FoodService,
      id: terminalId,
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
      terminalUrl: `${VESSELWATCH_BASE}${terminalId}`,
    };

    const [terminal, wasCreated] = Terminal.getOrCreate(terminalId, data);
    // existing terminal guard
    if (!wasCreated) {
      terminal.update(data);
    }
    terminal.save();
    refreshedTerminals.push(terminal);
  }
  refreshedTerminals.forEach((terminal) => {
    // setting routes depends on all the terminals already being cached
    terminal.update({
      mates: Route.getMatesByTerminalId(terminal.id),
      routes: Route.getByTerminalId(terminal.id),
    });
    terminal.save();
  });
  // commit after persistence
  // eslint-disable-next-line require-atomic-updates
  lastFlushDate = cacheFlushDate;

  logger.info(
    formatLogBlock("Terminal update complete", [
      {
        heading: "summary",
        lines: [`terminals: ${Object.keys(Terminal.getAll()).length}`],
      },
      {
        heading: "refreshed terminals",
        lines: formatTerminalList(
          refreshedTerminals.map((terminal) => terminal.id)
        ),
      },
    ])
  );
};
