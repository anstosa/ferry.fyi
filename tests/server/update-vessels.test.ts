import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const vesselModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
  getOrCreate: vi.fn(),
}));

const wsfApi = vi.hoisted(() => ({
  wsfRequest: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Terminal", () => ({
  Terminal: terminalModel,
}));

vi.mock("~/models/Vessel", () => ({
  Vessel: vesselModel,
}));

vi.mock("~/lib/wsf/api", () => wsfApi);

const { updateVesselStatus } = await import("../../server/lib/wsf/updateVessels");

// WSF date fixture
const wsfDate = (time: number): string => `/Date(${time * 1000}-0700)/`;

const departureLocation = { latitude: 47, longitude: -122 };
const arrivalLocation = { latitude: 48, longitude: -122 };

// route point fixture
const routePoint = (progress: number): { latitude: number; longitude: number } => ({
  latitude:
    departureLocation.latitude +
    (arrivalLocation.latitude - departureLocation.latitude) * progress,
  longitude: -122,
});

describe("vessel status GPS delay", () => {
  // reset mocks
  beforeEach(() => {
    scheduleModel.getAll.mockReset();
    terminalModel.getAll.mockReset();
    vesselModel.getAll.mockReset();
    vesselModel.getByIndex.mockReset();
    vesselModel.getOrCreate.mockReset();
    wsfApi.wsfRequest.mockReset();
    vesselModel.getAll.mockReturnValue({});
  });

  it("populates explicit GPS delay details during vessel status refresh", async () => {
    const departureTime = DateTime.fromISO("2026-06-21T10:00:00-07:00").toSeconds();
    const arrivalTime = departureTime + 100 * 60;
    const vessel = { departureDelta: 0, save: vi.fn(), update: vi.fn() };
    vi.useFakeTimers();
    vi.setSystemTime(new Date((departureTime + 62 * 60) * 1000));
    scheduleModel.getAll.mockReturnValue({
      route: {
        mateId: "2",
        slots: [
          {
            arrivalTime,
            time: departureTime,
            vessel: { id: "123" },
          },
        ],
        terminalId: "1",
      },
    });
    terminalModel.getAll.mockReturnValue({
      "1": { id: "1", location: departureLocation },
      "2": { id: "2", location: arrivalLocation },
    });
    vesselModel.getByIndex.mockReturnValue(vessel);
    wsfApi.wsfRequest.mockResolvedValue([
      {
        ArrivingTerminalID: 2,
        AtDock: false,
        DepartingTerminalID: 1,
        Eta: wsfDate(arrivalTime + 4 * 60),
        EtaBasis: "GPS",
        Heading: 0,
        Latitude: routePoint(0.5).latitude,
        LeftDock: wsfDate(departureTime + 8 * 60),
        Longitude: routePoint(0.5).longitude,
        Mmsi: 1,
        ScheduledDeparture: wsfDate(departureTime),
        Speed: 10,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);

    await updateVesselStatus();
    vi.useRealTimers();

    expect(vessel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        departureDelta: 8 * 60,
        gpsDelay: expect.objectContaining({
          confidence: "high",
          delaySeconds: 12 * 60,
          signals: expect.objectContaining({
            dockDelaySeconds: 8 * 60,
            etaDelaySeconds: 4 * 60,
            progress: 0.5,
          }),
          source: "gps",
        }),
      })
    );
  });

  it("preserves old delay fallback when active GPS leg is unavailable", async () => {
    const departureTime = DateTime.fromISO("2026-06-21T10:00:00-07:00").toSeconds();
    const vessel = { departureDelta: 5 * 60, save: vi.fn(), update: vi.fn() };
    scheduleModel.getAll.mockReturnValue({});
    terminalModel.getAll.mockReturnValue({});
    vesselModel.getByIndex.mockReturnValue(vessel);
    wsfApi.wsfRequest.mockResolvedValue([
      {
        AtDock: false,
        DepartingTerminalID: 1,
        Heading: 0,
        Latitude: 47,
        Longitude: -122,
        ScheduledDeparture: wsfDate(departureTime),
        Speed: 10,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);

    await updateVesselStatus();

    expect(vessel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        departureDelta: 5 * 60,
        gpsDelay: undefined,
      })
    );
  });
});
