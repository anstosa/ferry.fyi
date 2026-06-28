import { Op } from "sequelize";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistedBulletinModel = vi.hoisted(() => ({
  create: vi.fn(),
  findByPk: vi.fn(),
  update: vi.fn(),
}));

const wsfRequest = vi.hoisted(() => vi.fn());

vi.mock("heroku-logger", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("~/lib/push", () => ({
  sendPush: vi.fn(),
}));

vi.mock("~/lib/pushSubscriptions", () => ({
  getSubscribedTerminalPushMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/models/PersistedBulletin", () => ({
  PersistedBulletin: persistedBulletinModel,
}));

vi.mock("~/lib/wsf/api", () => ({
  wsfRequest,
}));

import { updateTerminals } from "~/lib/wsf/updateTerminals";
import { Bulletin } from "~/models/Bulletin";
import { Camera } from "~/models/Camera";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";

const terminalResponse = {
  AdaInfo: "",
  AddressLineOne: "1 Dock St",
  AddressLineTwo: "",
  AirportInfo: "",
  AirportShuttleInfo: "",
  BikeInfo: "",
  Bulletins: [
    {
      BulletinLastUpdated: "/Date(1781907734000-0700)/",
      BulletinSortSeq: 1,
      BulletinText: "<p>Use alternate route.</p>",
      BulletinTitle: "Muk/Clin - Service Alert - Dock work",
    },
  ],
  City: "Clinton",
  ConstructionInfo: "",
  Country: "US",
  DepartingDescription: "",
  DepartingTerminalID: 5,
  Directions: "",
  DispGISZoomLoc: [],
  Elevator: false,
  FoodService: false,
  FoodServiceInfo: "",
  Latitude: 47.9,
  Longitude: -122.4,
  LostAndFoundInfo: "",
  MapLink: "",
  MotorcycleInfo: "",
  OverheadPassengerLoading: false,
  ParkingInfo: "",
  ParkingShuttleInfo: "",
  RegionID: 1,
  Restroom: true,
  SecurityInfo: "",
  SortSeq: 1,
  State: "WA",
  TerminalAbbrev: "CLI",
  TerminalID: 5,
  TerminalName: "Clinton",
  TerminalSubjectID: 5,
  TrainInfo: "",
  TruckInfo: "",
  WaitTimes: [],
  WaitingRoom: false,
  ZipCode: "98236",
};

// reset cache and mocks
const resetState = (): void => {
  Bulletin.purge();
  Camera.purge();
  Route.purge();
  Terminal.purge();
  persistedBulletinModel.create.mockReset();
  persistedBulletinModel.findByPk.mockReset();
  persistedBulletinModel.update.mockReset();
  wsfRequest.mockReset();
  process.env.BASE_URL = "https://ferry.fyi";
};

describe("bulletin persistence", () => {
  beforeEach(() => {
    resetState();
  });

  it("persists active WSF bulletins and marks missing terminal rows inactive", async () => {
    persistedBulletinModel.findByPk.mockResolvedValue(null);
    wsfRequest
      .mockResolvedValueOnce("/Date(1781907800000-0700)/")
      .mockResolvedValueOnce([terminalResponse]);

    await updateTerminals();

    expect(persistedBulletinModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyHTML: "<p>Use alternate route.</p>",
        id: "5-1781907734-Muk/Clin - Service Alert - Dock work",
        inactiveAt: null,
        terminalId: "5",
        title: "Service Alert - Dock work",
      })
    );
    expect(persistedBulletinModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ inactiveAt: expect.any(Number) }),
      {
        where: expect.objectContaining({
          id: {
            [Op.notIn]: ["5-1781907734-Muk/Clin - Service Alert - Dock work"],
          },
          inactiveAt: null,
          terminalId: "5",
        }),
      }
    );
    expect(Terminal.getByIndex("5")?.bulletins).toHaveLength(1);
  });

  it("marks every active terminal bulletin inactive when WSF returns none", async () => {
    await Bulletin.markInactiveForTerminal("5", [], 1234);

    expect(persistedBulletinModel.update).toHaveBeenCalledWith(
      { inactiveAt: 1234 },
      {
        where: {
          inactiveAt: null,
          terminalId: "5",
        },
      }
    );
  });
});
