import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

// isolate schedule cache access
const scheduleModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

// isolate terminal cache access
const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

// isolate vessel cache access
const vesselModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
  getOrCreate: vi.fn(),
}));

// isolate WSF transport
const wsfApi = vi.hoisted(() => ({
  wsfRequest: vi.fn(),
}));

// isolate snapshot lifecycle
const vesselSnapshotIngestion = vi.hoisted(() => ({
  ingestLeaderboardVesselStatusRefresh: vi.fn(),
  pruneLeaderboardVesselVerificationSnapshots: vi.fn(),
  recordSkippedLeaderboardVesselStatusRefresh: vi.fn(),
}));

// silence fixed logger output
vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

// provide the schedule double
vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

// provide the terminal double
vi.mock("~/models/Terminal", () => ({
  Terminal: terminalModel,
}));

// provide the vessel double
vi.mock("~/models/Vessel", () => ({
  Vessel: vesselModel,
}));

// provide the WSF double
vi.mock("~/lib/wsf/api", () => wsfApi);

// provide the snapshot double
vi.mock(
  "~/services/leaderboardVesselSnapshotIngestion",
  () => vesselSnapshotIngestion
);

const { updateVesselStatus } =
  await import("../../server/lib/wsf/updateVessels");

// wsf date fixture
const wsfDate = (time: number): string => `/Date(${time * 1000}-0700)/`;

const departureLocation = { latitude: 47, longitude: -122 };
const arrivalLocation = { latitude: 48, longitude: -122 };

// route point fixture
const routePoint = (
  progress: number
): { latitude: number; longitude: number } => ({
  latitude:
    departureLocation.latitude +
    (arrivalLocation.latitude - departureLocation.latitude) * progress,
  longitude: -122,
});

// cover hydrated refresh behavior
describe("vessel status GPS delay", () => {
  // reset mocks
  beforeEach(() => {
    scheduleModel.getAll.mockReset();
    terminalModel.getAll.mockReset();
    vesselModel.getAll.mockReset();
    vesselModel.getByIndex.mockReset();
    vesselModel.getOrCreate.mockReset();
    wsfApi.wsfRequest.mockReset();
    const { ingestLeaderboardVesselStatusRefresh } = vesselSnapshotIngestion;
    const { pruneLeaderboardVesselVerificationSnapshots } =
      vesselSnapshotIngestion;
    const { recordSkippedLeaderboardVesselStatusRefresh } =
      vesselSnapshotIngestion;
    ingestLeaderboardVesselStatusRefresh.mockReset();
    pruneLeaderboardVesselVerificationSnapshots.mockReset();
    recordSkippedLeaderboardVesselStatusRefresh.mockReset();
    ingestLeaderboardVesselStatusRefresh.mockResolvedValue(undefined);
    pruneLeaderboardVesselVerificationSnapshots.mockResolvedValue(0);
    vesselModel.getAll.mockReturnValue({});
  });

  // verify hydrated status units
  it("populates explicit GPS delay details during vessel status refresh", async () => {
    const departureTime = DateTime.fromISO(
      "2026-06-21T10:00:00-07:00"
    ).toSeconds();
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
        departedTime: departureTime + 8 * 60,
        departureDelta: 8 * 60,
        scheduledDepartureTime: departureTime,
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
        statusUpdatedAt: (departureTime + 62 * 60) * 1000,
      })
    );
    expect(
      vesselSnapshotIngestion.ingestLeaderboardVesselStatusRefresh
    ).toHaveBeenCalledWith(expect.any(Array), {
      receivedAtMs: (departureTime + 62 * 60) * 1000,
    });
    expect(
      vesselSnapshotIngestion.pruneLeaderboardVesselVerificationSnapshots
    ).toHaveBeenCalledOnce();
    expect(
      vesselSnapshotIngestion.pruneLeaderboardVesselVerificationSnapshots
    ).toHaveBeenCalledWith({
      nowMs: (departureTime + 62 * 60) * 1000,
    });
  });

  // preserve cached delay without an active leg
  it("preserves old delay fallback when active GPS leg is unavailable", async () => {
    const departureTime = DateTime.fromISO(
      "2026-06-21T10:00:00-07:00"
    ).toSeconds();
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
        scheduledDepartureTime: departureTime,
      })
    );
  });

  // report an absent WSF response without fabricating history
  it("records skipped vessel status refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    wsfApi.wsfRequest.mockResolvedValue(undefined);

    await updateVesselStatus();
    vi.useRealTimers();

    expect(
      vesselSnapshotIngestion.recordSkippedLeaderboardVesselStatusRefresh
    ).toHaveBeenCalledWith(Date.parse("2026-08-17T12:00:00.000Z"));
    expect(
      vesselSnapshotIngestion.ingestLeaderboardVesselStatusRefresh
    ).not.toHaveBeenCalled();
    expect(
      vesselSnapshotIngestion.pruneLeaderboardVesselVerificationSnapshots
    ).toHaveBeenCalledOnce();
  });

  // isolate prune failures from public vessel refreshes
  it("keeps vessel status refreshes resilient to prune failures", async () => {
    const vessel = { departureDelta: 0, save: vi.fn(), update: vi.fn() };
    vesselModel.getByIndex.mockReturnValue(vessel);
    scheduleModel.getAll.mockReturnValue({});
    terminalModel.getAll.mockReturnValue({});
    wsfApi.wsfRequest.mockResolvedValue([
      {
        ArrivingTerminalID: 2,
        AtDock: false,
        DepartingTerminalID: 1,
        Heading: 0,
        InService: true,
        Latitude: 47,
        Longitude: -122,
        Speed: 10,
        TimeStamp: wsfDate(Math.floor(Date.now() / 1000)),
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);
    const { pruneLeaderboardVesselVerificationSnapshots } =
      vesselSnapshotIngestion;
    pruneLeaderboardVesselVerificationSnapshots.mockRejectedValue(
      new Error("prune failed")
    );

    await expect(updateVesselStatus()).resolves.toBeUndefined();

    expect(vessel.save).toHaveBeenCalledOnce();
    expect(
      vesselSnapshotIngestion.pruneLeaderboardVesselVerificationSnapshots
    ).toHaveBeenCalledOnce();
  });
});
