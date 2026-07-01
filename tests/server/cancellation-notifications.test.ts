import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/push", () => ({
  sendPush: vi.fn(),
}));

import {
  formatCancellationNotification,
  getCancellationNotificationEvents,
  resetCancellationNotificationState,
} from "~/lib/cancellationNotifications";
import { toWsfDate } from "~/lib/wsf/date";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const DEFAULT_TIME = DateTime.fromISO("2026-06-27T08:30:00", {
  zone: "America/Los_Angeles",
}).toSeconds();

// slot fixture
const makeSlot = ({
  cancellationReason,
  hasPassed = false,
  isCancelled = false,
  tideLevelM = null,
  time = DEFAULT_TIME,
}: {
  cancellationReason?: Slot["cancellationReason"];
  hasPassed?: boolean;
  isCancelled?: boolean;
  tideLevelM?: number | null;
  time?: number;
} = {}): Slot =>
  ({
    allowsPassengers: true,
    allowsVehicles: true,
    cancellationReason,
    crossing: {
      arrivalId: "17",
      departureDelta: 0,
      departureId: "11",
      departureTime: time,
      driveUpCapacity: isCancelled ? 0 : 50,
      hasDriveUp: true,
      hasReservations: false,
      isCancelled,
      reservableCapacity: 0,
      totalCapacity: 100,
    },
    hasPassed,
    mateId: "17",
    tide: {
      arrivalWaterLevelM: tideLevelM,
      stationId: "9444900",
      waterLevelM: tideLevelM,
    },
    time,
    vessel: { id: "kennewick", name: "Kennewick" },
    wuid: "Mon-08-30",
  }) as Slot;

// schedule fixture
const makeSchedule = (slot: Slot, date: string = toWsfDate()): Schedule =>
  ({
    date,
    key: `11-17-${date}`,
    mateId: "17",
    slots: [slot],
    terminalId: "11",
    validRange: null,
  }) as Schedule;

// multi-slot schedule fixture
const makeScheduleWithSlots = (
  slots: Slot[],
  date: string = toWsfDate()
): Schedule =>
  ({
    date,
    key: `11-17-${date}`,
    mateId: "17",
    slots,
    terminalId: "11",
    validRange: null,
  }) as Schedule;

// terminal fixture
const saveTerminal = (id: string, name: string, slug: string): void => {
  new Terminal({
    abbreviation: name.slice(0, 3).toUpperCase(),
    aliases: [slug],
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: false,
    hasWaitingRoom: false,
    id,
    info: {},
    location: { address: {}, latitude: 0, longitude: 0 },
    mates: [],
    name,
    popularity: 0,
    routes: {},
    slug,
    terminalUrl: "",
    vesselWatchUrl: "",
    waitTimes: [],
  }).save();
};

describe("cancellation notifications", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetCancellationNotificationState();
    Terminal.purge();
    process.env.BASE_URL = "https://ferry.fyi";
  });

  it("notifies when today's sailing enters tidal risk", () => {
    getCancellationNotificationEvents([makeSchedule(makeSlot())]);

    const events = getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 })),
    ]);

    expect(events).toMatchObject([
      {
        mateId: "17",
        state: "tidal-risk",
        terminalId: "11",
        type: "tidal-risk",
      },
    ]);
  });

  it("does not notify first current-day observation for known tidal risk", () => {
    const events = getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 })),
    ]);

    expect(events).toEqual([]);
  });

  it("notifies when known future tidal risk becomes today's service day", () => {
    const beforeServiceDay = DateTime.fromISO("2026-06-27T02:59:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    const afterServiceDay = DateTime.fromISO("2026-06-27T03:01:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(beforeServiceDay);
    getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 }), "2026-06-27"),
    ]);

    vi.setSystemTime(afterServiceDay);
    const events = getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 }), "2026-06-27"),
    ]);

    expect(events).toMatchObject([
      {
        state: "tidal-risk",
        type: "tidal-risk",
      },
    ]);
  });

  it("notifies when known future cancellation becomes today's service day", () => {
    const beforeServiceDay = DateTime.fromISO("2026-06-27T02:59:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    const afterServiceDay = DateTime.fromISO("2026-06-27T03:01:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(beforeServiceDay);
    getCancellationNotificationEvents([
      makeSchedule(
        makeSlot({ cancellationReason: "tidal", isCancelled: true }),
        "2026-06-27"
      ),
    ]);

    vi.setSystemTime(afterServiceDay);
    const events = getCancellationNotificationEvents([
      makeSchedule(
        makeSlot({ cancellationReason: "tidal", isCancelled: true }),
        "2026-06-27"
      ),
    ]);

    expect(events).toMatchObject([
      {
        state: "cancelled-tidal",
        type: "cancelled-tidal",
      },
    ]);
  });

  it("does not notify on first observation for known cancellations", () => {
    const events = getCancellationNotificationEvents([
      makeSchedule(
        makeSlot({
          cancellationReason: "tidal",
          isCancelled: true,
        })
      ),
    ]);

    expect(events).toEqual([]);
  });

  it("sends only confirmed notifications when risk and confirmed coexist", () => {
    const beforeServiceDay = DateTime.fromISO("2026-06-27T02:59:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    const afterServiceDay = DateTime.fromISO("2026-06-27T03:01:00", {
      zone: "America/Los_Angeles",
    }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(beforeServiceDay);
    getCancellationNotificationEvents([
      makeScheduleWithSlots(
        [
          makeSlot({
            cancellationReason: "tidal",
            isCancelled: true,
            time: DEFAULT_TIME,
          }),
          makeSlot({
            tideLevelM: -0.72,
            time: DEFAULT_TIME + 60 * 60,
          }),
        ],
        "2026-06-27"
      ),
    ]);

    vi.setSystemTime(afterServiceDay);
    const events = getCancellationNotificationEvents([
      makeScheduleWithSlots(
        [
          makeSlot({
            cancellationReason: "tidal",
            isCancelled: true,
            time: DEFAULT_TIME,
          }),
          makeSlot({
            tideLevelM: -0.72,
            time: DEFAULT_TIME + 60 * 60,
          }),
        ],
        "2026-06-27"
      ),
    ]);

    expect(events).toMatchObject([
      {
        state: "cancelled-tidal",
        type: "cancelled-tidal",
      },
    ]);
  });

  it("does not notify for future service days", () => {
    getCancellationNotificationEvents([makeSchedule(makeSlot(), "2099-01-01")]);

    const events = getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 }), "2099-01-01"),
    ]);

    expect(events).toEqual([]);
  });

  it("notifies when a sailing is confirmed tidally cancelled", () => {
    getCancellationNotificationEvents([makeSchedule(makeSlot())]);

    const events = getCancellationNotificationEvents([
      makeSchedule(
        makeSlot({ cancellationReason: "tidal", isCancelled: true })
      ),
    ]);

    expect(events).toMatchObject([
      {
        state: "cancelled-tidal",
        type: "cancelled-tidal",
      },
    ]);
  });

  it("notifies when a tidal risk clears", () => {
    getCancellationNotificationEvents([
      makeSchedule(makeSlot({ tideLevelM: -0.72 })),
    ]);

    const events = getCancellationNotificationEvents([
      makeSchedule(makeSlot()),
    ]);

    expect(events).toMatchObject([
      {
        state: "clear",
        type: "risk-cleared",
      },
    ]);
  });

  it("formats risk notifications without vessel names", () => {
    saveTerminal("11", "Coupeville", "coupeville");
    saveTerminal("17", "Port Townsend", "port-townsend");

    const content = formatCancellationNotification({
      key: `11:17:${DEFAULT_TIME}`,
      mateId: "17",
      state: "tidal-risk",
      terminalId: "11",
      time: DEFAULT_TIME,
      type: "tidal-risk",
    });

    expect(content).toEqual({
      body: "The 8:30 AM sailing is at tidal cancellation risk.",
      title: "Coupeville/Port Townsend may have cancellations",
      url: "https://ferry.fyi/coupeville/townsend",
    });
  });

  it("links non-tidal cancellation notifications to alerts", () => {
    saveTerminal("14", "Mukilteo", "mukilteo");
    saveTerminal("5", "Clinton", "clinton");

    const content = formatCancellationNotification({
      key: `14:5:${DEFAULT_TIME}`,
      mateId: "5",
      state: "cancelled-non-tidal",
      terminalId: "14",
      time: DEFAULT_TIME,
      type: "cancelled-non-tidal",
    });

    expect(content).toEqual({
      body: "WSF cancelled the 8:30 AM sailing.",
      title: "Mukilteo/Clinton has cancellations",
      url: "https://ferry.fyi/mukilteo/clinton/alerts",
    });
  });
});
