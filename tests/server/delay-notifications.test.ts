import type { Slot } from "shared/contracts/schedules";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/push", () => ({
  sendPush: vi.fn(),
}));

import {
  formatDelayNotification,
  getDelayNotificationEvents,
  resetDelayNotificationState,
} from "~/lib/delayNotifications";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const baseVessel = {
  horsepower: 2400,
  id: "tokitae",
  name: "Tokitae",
  tallVehicleCapacity: 0,
  vehicleCapacity: 100,
  weight: 1000,
};

// slot fixture
const makeSlot = (
  delayMins: number,
  vessel: typeof baseVessel = baseVessel,
  time: number = 1000
): Slot =>
  ({
    allowsPassengers: true,
    allowsVehicles: true,
    crossing: {
      arrivalId: "5",
      departureDelta: delayMins * 60,
      departureId: "14",
      departureTime: time,
      driveUpCapacity: 50,
      hasDriveUp: true,
      hasReservations: false,
      isCancelled: false,
      reservableCapacity: 0,
      totalCapacity: 100,
    },
    hasPassed: false,
    mateId: "5",
    time,
    vessel,
    wuid: "Mon-10-00",
  }) as Slot;

// schedule fixture
const makeSchedule = (delayMins: number): Schedule =>
  ({
    date: "2026-06-27",
    key: "14-5-2026-06-27",
    mateId: "5",
    slots: [makeSlot(delayMins)],
    terminalId: "14",
    validRange: null,
  }) as Schedule;

describe("delay notifications", () => {
  beforeEach(() => {
    resetDelayNotificationState();
    Terminal.purge();
    process.env.BASE_URL = "https://ferry.fyi";
  });

  it("notifies when a vessel crosses a projected delay threshold", () => {
    getDelayNotificationEvents([makeSchedule(14)]);

    const events = getDelayNotificationEvents([makeSchedule(17)]);

    expect(events).toMatchObject([
      {
        delayMins: 17,
        mateId: "5",
        terminalId: "14",
        threshold: 15,
        type: "behind",
        vesselName: "Tokitae",
      },
    ]);
  });

  it("tracks each vessel on the route independently", () => {
    const suquamish = { ...baseVessel, id: "suquamish", name: "Suquamish" };
    getDelayNotificationEvents([
      {
        ...makeSchedule(14),
        slots: [makeSlot(14), makeSlot(29, suquamish, 2000)],
      } as Schedule,
    ]);

    const events = getDelayNotificationEvents([
      {
        ...makeSchedule(17),
        slots: [makeSlot(17), makeSlot(31, suquamish, 2000)],
      } as Schedule,
    ]);

    expect(events).toMatchObject([
      { threshold: 15, vesselName: "Tokitae" },
      { threshold: 30, vesselName: "Suquamish" },
    ]);
  });

  it("uses the highest newly crossed threshold after a jump", () => {
    getDelayNotificationEvents([makeSchedule(17)]);

    const events = getDelayNotificationEvents([makeSchedule(46)]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threshold: 45, type: "behind" });
  });

  it("notifies when a delayed vessel returns to schedule", () => {
    getDelayNotificationEvents([makeSchedule(17)]);

    const events = getDelayNotificationEvents([makeSchedule(0)]);

    expect(events).toMatchObject([
      {
        delayMins: 0,
        type: "on-schedule",
        vesselName: "Tokitae",
      },
    ]);
  });

  it("formats notifications for the schedule page", () => {
    new Terminal({
      abbreviation: "MUK",
      aliases: ["muk"],
      bulletins: [],
      cameras: [],
      hasElevator: false,
      hasFood: false,
      hasOverheadLoading: false,
      hasRestroom: false,
      hasWaitingRoom: false,
      id: "14",
      info: {},
      location: { address: {}, latitude: 0, longitude: 0 },
      mates: [],
      name: "Mukilteo",
      popularity: 0,
      routes: {},
      slug: "mukilteo",
      terminalUrl: "",
      vesselWatchUrl: "",
      waitTimes: [],
    }).save();
    new Terminal({
      abbreviation: "CLI",
      aliases: ["cli"],
      bulletins: [],
      cameras: [],
      hasElevator: false,
      hasFood: false,
      hasOverheadLoading: false,
      hasRestroom: false,
      hasWaitingRoom: false,
      id: "5",
      info: {},
      location: { address: {}, latitude: 0, longitude: 0 },
      mates: [],
      name: "Clinton",
      popularity: 0,
      routes: {},
      slug: "clinton",
      terminalUrl: "",
      vesselWatchUrl: "",
      waitTimes: [],
    }).save();

    const content = formatDelayNotification({
      delayMins: 17,
      key: "14:5:tokitae",
      mateId: "5",
      terminalId: "14",
      threshold: 15,
      type: "behind",
      vesselName: "Tokitae",
    });

    expect(content).toEqual({
      body: "Tokitae is running 17mins late",
      title: "Mukilteo/Clinton is 15+ mins behind",
      url: "https://ferry.fyi/mukilteo/clinton",
    });
  });
});
