import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("~/lib/logger", () => ({
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
  // rolled WSF departure identity
  it("keeps a late through-sailing on its original slot across status polls", async () => {
    const original = DateTime.fromISO("2026-09-25T15:35:00-07:00").toSeconds();
    const rolled = DateTime.fromISO("2026-09-25T16:40:00-07:00").toSeconds();
    const departed = DateTime.fromISO("2026-09-25T16:29:00-07:00").toSeconds();
    const vessel = { departureDelta: 0, save: vi.fn(), update: vi.fn() };
    const crossing = {
      departureDelta: null as number | null,
      // mirror the persisted crossing update
      update: vi
        .fn()
        .mockImplementation((values: { departureDelta: number }) => {
          crossing.departureDelta = values.departureDelta;
          return Promise.resolve();
        }),
    };
    const throughCrossing = {
      departureDelta: null as number | null,
      // mirror the second persisted crossing update
      update: vi
        .fn()
        .mockImplementation((values: { departureDelta: number }) => {
          throughCrossing.departureDelta = values.departureDelta;
          return Promise.resolve();
        }),
    };
    const slots = [
      {
        arrivalTime: original + 20 * 60,
        crossing,
        time: original,
        vessel: { id: "123" },
      },
      { arrivalTime: rolled + 20 * 60, time: rolled, vessel: { id: "123" } },
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date((original + 45 * 60) * 1000));
    scheduleModel.getAll.mockReturnValue({
      route: {
        mateId: "2",
        // resolve the immediate destination slot
        getSlot: (time: number) => slots.find((slot) => slot.time === time),
        slots,
        terminalId: "1",
      },
      throughRoute: {
        mateId: "3",
        // resolve the downstream destination slot
        getSlot: (time: number) =>
          time === original
            ? { crossing: throughCrossing, vessel: { id: "123" } }
            : null,
        slots: [
          {
            arrivalTime: original + 40 * 60,
            crossing: throughCrossing,
            time: original,
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
        AtDock: true,
        DepartingTerminalID: 1,
        Heading: 0,
        Latitude: departureLocation.latitude,
        LeftDock: wsfDate(original - 60 * 60),
        Longitude: departureLocation.longitude,
        Mmsi: 1,
        ScheduledDeparture: wsfDate(rolled),
        Speed: 0,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);

    await updateVesselStatus();

    expect(vessel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        departedTime: undefined,
        departureDelta: 0,
        scheduledDepartureTime: original,
        gpsDelay: expect.objectContaining({
          delaySeconds: 45 * 60,
          signals: expect.objectContaining({
            dockDelaySeconds: null,
            scheduledDepartureTime: original,
          }),
        }),
      })
    );
    expect(crossing.update).not.toHaveBeenCalled();
    expect(throughCrossing.update).not.toHaveBeenCalled();

    // persist the actual departure after the vessel leaves the dock
    vi.setSystemTime(new Date((departed + 8 * 60) * 1000));
    wsfApi.wsfRequest.mockResolvedValue([
      {
        ArrivingTerminalID: 2,
        AtDock: false,
        DepartingTerminalID: 1,
        Eta: wsfDate(departed + 20 * 60),
        Heading: 0,
        Latitude: routePoint(0.4).latitude,
        LeftDock: wsfDate(departed),
        Longitude: routePoint(0.4).longitude,
        Mmsi: 1,
        ScheduledDeparture: wsfDate(rolled),
        Speed: 10,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);

    await updateVesselStatus();

    expect(vessel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        departureDelta: 54 * 60,
        scheduledDepartureTime: original,
        gpsDelay: expect.objectContaining({
          signals: expect.objectContaining({
            dockDelaySeconds: 54 * 60,
            scheduledDepartureTime: original,
          }),
        }),
      })
    );
    expect(crossing.update).toHaveBeenCalledWith({ departureDelta: 54 * 60 });
    expect(throughCrossing.update).toHaveBeenCalledWith({
      departureDelta: 54 * 60,
    });

    // keep the observation after the vessel advances to another leg
    wsfApi.wsfRequest.mockResolvedValue([
      {
        ArrivingTerminalID: 1,
        AtDock: false,
        DepartingTerminalID: 2,
        Heading: 0,
        Latitude: routePoint(0.6).latitude,
        LeftDock: wsfDate(rolled + 60 * 60),
        Longitude: routePoint(0.6).longitude,
        Mmsi: 1,
        ScheduledDeparture: wsfDate(rolled + 60 * 60),
        Speed: 10,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);
    vi.setSystemTime(new Date((rolled + 70 * 60) * 1000));
    await updateVesselStatus();
    expect(crossing.departureDelta).toBe(54 * 60);
    expect(crossing.update).toHaveBeenCalledTimes(1);
    expect(throughCrossing.departureDelta).toBe(54 * 60);
    expect(throughCrossing.update).toHaveBeenCalledTimes(1);
  });

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

  // restore clock after every status scenario
  afterEach(() => {
    vi.useRealTimers();
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
