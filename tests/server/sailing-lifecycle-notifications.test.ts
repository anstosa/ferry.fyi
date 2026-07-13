import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/push", () => ({
  sendPush: vi.fn(),
}));

const pushSubscriptions = vi.hoisted(() => ({
  getSubscribedTerminalPushMessages: vi.fn(),
  removeCompletedOneTimeSailingAlertRules: vi.fn(),
}));

vi.mock("~/lib/pushSubscriptions", () => pushSubscriptions);

import {
  formatSailingLifecycleNotification,
  getSailingLifecycleNotificationEvents,
  resetSailingLifecycleNotificationState,
  sendSailingLifecycleNotifications,
} from "~/lib/sailingLifecycleNotifications";
import { toWsfDate } from "~/lib/wsf/date";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";

const NOW = DateTime.fromISO("2026-07-05T12:00:00", {
  zone: "America/Los_Angeles",
});
const DEPARTURE_TIME = NOW.plus({ minutes: 5 }).toSeconds();
const ARRIVAL_TIME = NOW.plus({ minutes: 40 }).toSeconds();

// terminal fixture
const saveTerminal = ({
  hasOverheadLoading = false,
  id,
  latitude,
  longitude,
  name,
  slug,
}: {
  hasOverheadLoading?: boolean;
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  slug: string;
}): void => {
  new Terminal({
    abbreviation: name.slice(0, 3).toUpperCase(),
    aliases: [slug],
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading,
    hasRestroom: false,
    hasWaitingRoom: false,
    id,
    info: {},
    location: { address: {}, latitude, longitude },
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

// vessel fixture
const saveVessel = (data: Partial<Vessel> = {}): void => {
  new Vessel({
    abbreviation: "TOK",
    arrivingTerminalId: 5,
    beam: "",
    classId: "",
    departingTerminalId: 14,
    hasCarDeckRestroom: false,
    hasElevator: false,
    hasGalley: false,
    hasRestroom: false,
    hasWiFi: false,
    horsepower: 0,
    id: "68",
    inMaintenance: false,
    inService: true,
    info: {},
    isAdaAccessible: true,
    isAtDock: false,
    maxClearance: 0,
    name: "Tokitae",
    passengerCapacity: 0,
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: 100,
    vesselWatchUrl: "",
    weight: 0,
    yearBuilt: 0,
    yearRebuilt: 0,
    ...data,
  }).save();
};

// schedule fixture
const makeSchedule = (): Schedule =>
  ({
    date: toWsfDate(),
    key: `14-5-${toWsfDate()}`,
    mateId: "5",
    slots: [
      {
        allowsPassengers: true,
        allowsVehicles: true,
        arrivalTime: ARRIVAL_TIME,
        crossing: {
          arrivalId: "5",
          departureDelta: 0,
          departureId: "14",
          departureTime: DEPARTURE_TIME,
          driveUpCapacity: 20,
          hasDriveUp: true,
          hasReservations: false,
          isCancelled: false,
          reservableCapacity: 0,
          totalCapacity: 100,
        },
        hasPassed: false,
        mateId: "5",
        time: DEPARTURE_TIME,
        vessel: { id: "68", name: "Tokitae" },
        wuid: "Sun-12-05",
      } as Slot,
    ],
    terminalId: "14",
    validRange: null,
  }) as Schedule;

describe("sailing lifecycle notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW.toJSDate());
    resetSailingLifecycleNotificationState();
    pushSubscriptions.getSubscribedTerminalPushMessages.mockReset();
    pushSubscriptions.removeCompletedOneTimeSailingAlertRules.mockReset();
    Schedule.purge();
    Terminal.purge();
    Vessel.purge();
    process.env.BASE_URL = "https://ferry.fyi";
    saveTerminal({
      hasOverheadLoading: true,
      id: "14",
      latitude: 47.95,
      longitude: -122.3,
      name: "Mukilteo",
      slug: "mukilteo",
    });
    saveTerminal({
      id: "5",
      latitude: 47.97,
      longitude: -122.35,
      name: "Clinton",
      slug: "clinton",
    });
  });

  it("notifies one-time subscribers when the incoming vessel docks", () => {
    saveVessel({
      dockedTime: NOW.minus({ minutes: 1 }).toSeconds(),
      isAtDock: true,
      location: { latitude: 47.95, longitude: -122.3 },
    });

    const events = getSailingLifecycleNotificationEvents(
      [makeSchedule()],
      NOW.toSeconds()
    );
    const content = formatSailingLifecycleNotification(events[0]);

    expect(events).toMatchObject([{ type: "prepare-board" }]);
    expect(content).toEqual({
      body: "Tokitae has docked. Return to your vehicle. Walk-on passengers should report to the overhead passenger loading area.",
      title: "Prepare to board",
      url: `https://ferry.fyi/mukilteo/clinton?date=${toWsfDate()}&sailing=${DEPARTURE_TIME}&tab=sailing`,
    });
  });

  it("notifies when the vessel departs with notable delay copy", () => {
    saveVessel({
      departedTime: DEPARTURE_TIME + 5 * 60,
      isAtDock: false,
    });

    const events = getSailingLifecycleNotificationEvents(
      [makeSchedule()],
      DEPARTURE_TIME + 6 * 60
    );
    const content = formatSailingLifecycleNotification(events[0]);

    expect(events).toMatchObject([{ type: "departed" }]);
    expect(content?.body).toBe("Tokitae departed 5 mins late.");
  });

  it("notifies when ETA reaches five minutes with destination instructions", () => {
    saveVessel({
      departedTime: DEPARTURE_TIME,
      estimatedArrivalTime: ARRIVAL_TIME,
      isAtDock: false,
    });

    const events = getSailingLifecycleNotificationEvents(
      [makeSchedule()],
      ARRIVAL_TIME - 4 * 60
    );
    const content = formatSailingLifecycleNotification(events[0]);

    expect(events).toMatchObject([{ type: "prepare-disembark" }]);
    expect(content?.body).toBe(
      "Tokitae is about 5 mins from Clinton. Return to your vehicle. Walk-on passengers should report to the front of the car deck."
    );
  });

  it("notifies when the vessel arrives and does not repeat", () => {
    saveVessel({
      dockedTime: ARRIVAL_TIME + 5 * 60,
      isAtDock: true,
      location: { latitude: 47.97, longitude: -122.35 },
    });

    const firstEvents = getSailingLifecycleNotificationEvents(
      [makeSchedule()],
      ARRIVAL_TIME + 6 * 60
    );
    const secondEvents = getSailingLifecycleNotificationEvents(
      [makeSchedule()],
      ARRIVAL_TIME + 7 * 60
    );
    const content = formatSailingLifecycleNotification(firstEvents[0]);

    expect(firstEvents).toMatchObject([{ type: "arrived" }]);
    expect(secondEvents).toEqual([]);
    expect(content?.body).toBe("Tokitae arrived 5 mins late.");
  });

  // completed subscription cleanup
  it("removes matching one-time rules after the vessel arrives", async () => {
    saveVessel({
      dockedTime: ARRIVAL_TIME + 5 * 60,
      isAtDock: true,
      location: { latitude: 47.97, longitude: -122.35 },
    });
    new Schedule(makeSchedule()).save();
    pushSubscriptions.getSubscribedTerminalPushMessages.mockResolvedValue([]);
    // trigger the post-arrival lifecycle event
    vi.setSystemTime(DateTime.fromSeconds(ARRIVAL_TIME + 6 * 60).toJSDate());

    await sendSailingLifecycleNotifications();

    expect(
      pushSubscriptions.removeCompletedOneTimeSailingAlertRules
    ).toHaveBeenCalledWith({
      routeKey: "14:5",
      sailingTime: DateTime.fromSeconds(DEPARTURE_TIME),
      terminalId: "14",
    });
  });
});
