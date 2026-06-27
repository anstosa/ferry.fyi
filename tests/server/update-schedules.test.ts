import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeModel = vi.hoisted(() => ({
  getByTerminalId: vi.fn(),
}));

const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getAll: vi.fn(),
  getByIndex: vi.fn(),
  getOrCreate: vi.fn(),
  hasFetchedDate: vi.fn(),
}));

const crossingModel = vi.hoisted(() => ({
  build: vi.fn(),
  findOne: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const vesselModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
}));

const wsfApi = vi.hoisted(() => ({
  wsfRequest: vi.fn(),
}));

const tidalCancellations = vi.hoisted(() => ({
  getTidalCancellationsForDate: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/models/Route", () => ({
  Route: routeModel,
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

vi.mock("~/lib/wsf/tidalCancellations", () => tidalCancellations);

const { getPreviousCrossing, updateSchedules } =
  await import("../../server/lib/wsf/updateSchedules");

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

describe("schedule update helpers", () => {
  // reset schedule mocks
  beforeEach(() => {
    routeModel.getByTerminalId.mockReset();
    scheduleModel.generateKey.mockReset();
    scheduleModel.getAll.mockReset();
    scheduleModel.getByIndex.mockReset();
    scheduleModel.getOrCreate.mockReset();
    scheduleModel.hasFetchedDate.mockReset();
    crossingModel.build.mockReset();
    crossingModel.findOne.mockReset();
    terminalModel.getAll.mockReset();
    tidalCancellations.getTidalCancellationsForDate.mockReset();
    vesselModel.getAll.mockReset();
    vesselModel.getByIndex.mockReset();
    wsfApi.wsfRequest.mockReset();
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-21");
    crossingModel.build.mockImplementation((data) => ({
      ...data,
      hasPassed: () => false,
      toJSON: () => data,
    }));
    routeModel.getByTerminalId.mockReturnValue({
      route: { crossingTime: 30, terminalIds: ["1", "2"] },
    });
    vesselModel.getAll.mockReturnValue({});
    tidalCancellations.getTidalCancellationsForDate.mockResolvedValue([]);
  });

  // previous crossing lookup
  it("returns the preceding scheduled crossing in numeric departure order", () => {
    const firstCrossing = { id: "first" };
    const secondCrossing = { id: "second" };
    const firstTime = toSeconds("2026-06-21T09:00:00");
    const secondTime = toSeconds("2026-06-21T10:00:00");
    const laterTime = toSeconds("2026-06-21T11:00:00");
    scheduleModel.getByIndex.mockReturnValue({
      getSlot: (departureTime: number) => {
        // first slot guard
        if (departureTime === firstTime) {
          return { crossing: firstCrossing };
        }
        // second slot guard
        if (departureTime === secondTime) {
          return { crossing: secondCrossing };
        }
        return null;
      },
      slots: [
        { crossing: secondCrossing, time: secondTime },
        { crossing: firstCrossing, time: firstTime },
        { time: laterTime },
      ],
    });

    expect(getPreviousCrossing("1", "2", laterTime)).toBe(secondCrossing);
  });

  // vessel delay preservation
  it("keeps boat-level delay when refreshing schedules", async () => {
    const vessel = {
      id: "123",
      departureDelta: 12 * 60,
      save: vi.fn(),
      update: vi.fn(),
    };
    const schedule = {
      key: "1-2-2026-06-21",
      save: vi.fn(),
      slots: [],
      update: vi.fn(),
    };
    wsfApi.wsfRequest
      .mockResolvedValueOnce("/Date(1782068400000-0700)/")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        TerminalCombos: [
          {
            Times: [
              {
                DepartingTime: "/Date(1782072000000-0700)/",
                LoadingRule: 3,
                VesselID: 123,
                VesselPositionNum: 1,
              },
            ],
          },
        ],
      });
    scheduleModel.getByIndex.mockReturnValue(null);
    crossingModel.findOne.mockResolvedValue(null);
    vesselModel.getByIndex.mockReturnValue(vessel);
    scheduleModel.getOrCreate.mockReturnValue([schedule, true]);
    scheduleModel.getAll.mockImplementation(() => {
      // refreshed schedule cache
      return { [schedule.key]: schedule };
    });

    await updateSchedules("2026-06-21", "1", "2");

    expect(scheduleModel.getOrCreate).toHaveBeenCalledWith(
      "1-2-2026-06-21",
      expect.objectContaining({
        slots: [
          expect.objectContaining({
            arrivalTime: 1782072000 + 30 * 60,
          }),
        ],
      })
    );
    expect(vessel.update).not.toHaveBeenCalledWith({ departureDelta: 0 });
    expect(vessel.departureDelta).toBe(12 * 60);
  });

  // tidal cancellation merge
  it("adds tidal cancellations that are missing from the WSF schedule", async () => {
    const salish = {
      id: "66",
      name: "Salish",
      vehicleCapacity: 64,
    };
    const kennewick = {
      id: "52",
      name: "Kennewick",
      vehicleCapacity: 64,
    };
    const schedule = {
      key: "17-11-2026-06-27",
      save: vi.fn(),
      slots: [],
      update: vi.fn(),
    };
    const cancelledTime = toSeconds("2026-06-27T06:30:00");
    const firstReturnedTime = toSeconds("2026-06-27T08:00:00");
    scheduleModel.generateKey.mockReturnValue("17-11-2026-06-27");
    routeModel.getByTerminalId.mockReturnValue({
      route: { crossingTime: 35, terminalIds: ["17", "11"] },
    });
    vesselModel.getByIndex.mockImplementation((id: string) => {
      // salish fixture
      if (id === "66") {
        return salish;
      }
      // kennewick fixture
      if (id === "52") {
        return kennewick;
      }
      return null;
    });
    wsfApi.wsfRequest
      .mockResolvedValueOnce("/Date(1782539760000-0700)/")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        TerminalCombos: [
          {
            Times: [
              {
                DepartingTime: `/Date(${firstReturnedTime * 1000}-0700)/`,
                LoadingRule: 3,
                VesselID: 52,
                VesselPositionNum: 2,
              },
            ],
          },
        ],
      });
    crossingModel.findOne.mockResolvedValue(null);
    tidalCancellations.getTidalCancellationsForDate.mockResolvedValue([
      {
        arrivalId: "11",
        departureId: "17",
        departureTime: cancelledTime,
        vesselId: "66",
        vesselName: "Salish",
        vesselPosition: 1,
      },
    ]);
    scheduleModel.getByIndex.mockReturnValue(null);
    scheduleModel.getOrCreate.mockReturnValue([schedule, true]);
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });

    await updateSchedules("2026-06-27", "17", "11");

    expect(
      tidalCancellations.getTidalCancellationsForDate
    ).toHaveBeenCalledWith("2026-06-27", "17", "11");
    expect(scheduleModel.getOrCreate).toHaveBeenCalledWith(
      "17-11-2026-06-27",
      expect.objectContaining({
        slots: [
          expect.objectContaining({
            cancellationReason: "tidal",
            crossing: expect.objectContaining({
              isCancelled: true,
              totalCapacity: 64,
            }),
            time: cancelledTime,
            vessel: salish,
            vesselPosition: 1,
          }),
          expect.objectContaining({
            time: firstReturnedTime,
            vessel: kennewick,
            vesselPosition: 2,
          }),
        ],
      })
    );
  });

  // cached tidal refresh
  it("refreshes tidal cancellations when the WSF schedule cache is otherwise fresh", async () => {
    const salish = {
      id: "66",
      name: "Salish",
      vehicleCapacity: 64,
    };
    const schedule = {
      key: "17-11-2026-06-27",
      mateId: "11",
      save: vi.fn(),
      slots: [],
      terminalId: "17",
      update: vi.fn(),
    };
    const cancelledTime = toSeconds("2026-06-27T06:30:00");
    scheduleModel.generateKey.mockReturnValue("17-11-2026-06-27");
    vesselModel.getByIndex.mockReturnValue(salish);
    wsfApi.wsfRequest
      .mockResolvedValueOnce("/Date(1782539760000-0700)/")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ TerminalCombos: [{ Times: [] }] });
    scheduleModel.getByIndex.mockReturnValue(null);
    scheduleModel.getOrCreate.mockReturnValue([schedule, true]);
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    await updateSchedules("2026-06-27", "17", "11");

    wsfApi.wsfRequest.mockClear();
    schedule.update.mockClear();
    schedule.save.mockClear();
    scheduleModel.hasFetchedDate.mockReturnValue(true);
    scheduleModel.getByIndex.mockReturnValue(schedule);
    wsfApi.wsfRequest.mockResolvedValueOnce("/Date(1782539760000-0700)/");
    tidalCancellations.getTidalCancellationsForDate.mockResolvedValue([
      {
        arrivalId: "11",
        departureId: "17",
        departureTime: cancelledTime,
        vesselId: "66",
        vesselName: "Salish",
        vesselPosition: 1,
      },
    ]);

    await updateSchedules("2026-06-27", "17", "11");

    expect(wsfApi.wsfRequest).toHaveBeenCalledOnce();
    expect(schedule.update).toHaveBeenCalledWith({
      slots: [
        expect.objectContaining({
          cancellationReason: "tidal",
          crossing: expect.objectContaining({ isCancelled: true }),
          time: cancelledTime,
          vessel: salish,
        }),
      ],
    });
    expect(schedule.save).toHaveBeenCalledOnce();
  });
});
