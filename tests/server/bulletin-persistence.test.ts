import { Op, UniqueConstraintError } from "sequelize";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistedBulletinModel = vi.hoisted(() => ({
  create: vi.fn(),
  findByPk: vi.fn(),
  update: vi.fn(),
}));

const wsfRequest = vi.hoisted(() => vi.fn());

vi.mock("~/lib/logger", () => ({
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
import { sendPush } from "~/lib/push";
import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";
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
  vi.mocked(sendPush).mockClear();
  vi.mocked(getSubscribedTerminalPushMessages).mockClear();
  process.env.BASE_URL = "https://ferry.fyi";
};

describe("bulletin persistence", () => {
  beforeEach(() => {
    resetState();
  });

  // retain upstream history without publishing or pushing opinion-group promotions
  it("filters opinion-group alerts from public terminals and push delivery", async () => {
    const now = Math.floor(Date.now() / 1000) + 1;
    persistedBulletinModel.findByPk.mockResolvedValue(null);
    wsfRequest
      .mockResolvedValueOnce(`/Date(${now * 1000}-0700)/`)
      .mockResolvedValueOnce([
        {
          ...terminalResponse,
          Bulletins: [
            ...terminalResponse.Bulletins,
            {
              BulletinLastUpdated: `/Date(${now * 1000}-0700)/`,
              BulletinSortSeq: 2,
              BulletinText: "<p>Join the Ferry Riders Opinion Group.</p>",
              BulletinTitle: "All Routes - Have your say",
            },
          ],
        },
      ]);

    await updateTerminals();

    expect(persistedBulletinModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreAll: true,
        level: "high",
        title: "All Routes - Have your say",
      })
    );
    const terminal = Terminal.getByIndex("5");
    expect(terminal?.bulletins).toHaveLength(2);
    expect(terminal?.serialize().bulletins).toMatchObject([
      { title: "Service Alert - Dock work" },
    ]);
    expect(getSubscribedTerminalPushMessages).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  // persist canonical links while retaining bulletin lifecycle behavior
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
        url: "https://ferry.fyi/clinton/alerts",
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

  // bundled raw bulletins must follow the same public suppression rules
  it("filters opinion-group promotions from unrefreshed terminal seed data", () => {
    const terminal = new Terminal({
      id: "5",
      bulletins: [
        {
          bodyHTML: "<p>Join the Ferry Riders Opinion Group.</p>",
          date: 1,
          terminalId: "5",
          title: "Have your say",
        },
        {
          bodyHTML: "<p>Use alternate route.</p>",
          date: 1,
          terminalId: "5",
          title: "Dock work",
        },
      ],
    });

    expect(terminal.serialize().bulletins).toMatchObject([
      { title: "Dock work" },
    ]);
  });

  // insert race regression
  it("updates an existing row when a concurrent insert wins the race", async () => {
    persistedBulletinModel.findByPk.mockResolvedValue(null);
    persistedBulletinModel.create.mockRejectedValue(
      new UniqueConstraintError({ message: "duplicate bulletin" })
    );

    const bulletin = new Bulletin({
      bodyHTML: "<p>Use alternate route.</p>",
      date: 1781907734,
      terminalId: "5",
      title: "Muk/Clin - Service Alert - Dock work",
      url: "https://ferry.fyi/5/alerts",
    });

    await bulletin.persistActive(1781907800);

    expect(persistedBulletinModel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        inactiveAt: null,
        lastSeenAt: 1781907800,
        title: "Service Alert - Dock work",
        url: "https://ferry.fyi/clinton/alerts",
      }),
      {
        where: {
          id: "5-1781907734-Muk/Clin - Service Alert - Dock work",
        },
      }
    );
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
