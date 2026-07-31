import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDelayRecoveryMins,
  getProjectedDelayMins,
  getProjectedTiming,
} from "../../client/views/Schedule/projectedTiming";

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const vessel = {
  horsepower: 2400,
  tallVehicleCapacity: 0,
  vehicleCapacity: 100,
  weight: 1000,
};

const DEFAULT_VESSEL_ID = "vessel";

// build slot fixture
const makeSlot = ({
  delayMins,
  driveUpCapacity,
  estimateDriveUpCapacity,
  hasPassed = false,
  arrivalTime,
  time,
  gpsDelayMins,
  horsepower,
  totalCapacity,
  vesselDelayMins,
  vesselId = DEFAULT_VESSEL_ID,
  weather,
  weight,
}: {
  arrivalTime?: string;
  delayMins?: number;
  gpsDelayMins?: number;
  driveUpCapacity?: number;
  estimateDriveUpCapacity?: number;
  hasPassed?: boolean;
  horsepower?: number;
  time: string;
  totalCapacity?: number;
  vesselDelayMins?: number;
  vesselId?: string | null;
  weather?: Slot["weather"];
  weight?: number;
}): Slot =>
  ({
    ...(arrivalTime === undefined
      ? {}
      : { arrivalTime: toSeconds(arrivalTime) }),
    crossing:
      driveUpCapacity === undefined && delayMins === undefined
        ? undefined
        : {
            departureDelta: delayMins === undefined ? null : delayMins * 60,
            driveUpCapacity: driveUpCapacity ?? 100,
            isCancelled: false,
            reservableCapacity: 0,
            totalCapacity: totalCapacity ?? 100,
          },
    estimate:
      estimateDriveUpCapacity === undefined
        ? undefined
        : {
            driveUpCapacity: estimateDriveUpCapacity,
            reservableCapacity: 0,
          },
    hasPassed,
    time: toSeconds(time),
    ...(weather === undefined ? {} : { weather }),
    // vessel delay fixture
    vessel: {
      ...vessel,
      ...(horsepower === undefined ? {} : { horsepower }),
      ...(vesselDelayMins === undefined
        ? {}
        : { departureDelta: vesselDelayMins * 60 }),
      ...(weight === undefined ? {} : { weight }),
      ...(gpsDelayMins === undefined
        ? {}
        : {
            gpsDelay: {
              confidence: "high",
              delaySeconds: gpsDelayMins * 60,
              explanation: "GPS fixture",
              signals: {
                dockDelaySeconds: null,
                etaDelaySeconds: null,
                progress: 0.5,
                scheduledArrivalTime: toSeconds(time) + 1800,
                scheduledDepartureTime: toSeconds(time),
              },
              source: "gps",
            },
          }),
      ...(vesselId === null ? {} : { id: vesselId }),
    },
  }) as Slot;

describe("projected schedule timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(
      DateTime.fromISO("2026-06-21T09:00:00", {
        zone: "America/Los_Angeles",
      }).toJSDate()
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses recorded departure time for past sailings", () => {
    const slot = makeSlot({
      delayMins: 12,
      hasPassed: true,
      time: "2026-06-21T10:00:00",
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(12);
    expect(
      getProjectedTiming({ schedule: [slot], slot }).departureTime.toFormat(
        "h:mm"
      )
    ).toBe("10:12");
  });

  it("uses boat-level delay for upcoming sailings without terminal delay", () => {
    const slot = makeSlot({
      time: "2026-06-21T10:00:00",
      vesselDelayMins: 12,
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(12);
    expect(
      getProjectedTiming({ schedule: [slot], slot }).departureTime.toFormat(
        "h:mm"
      )
    ).toBe("10:12");
  });

  it("does not seed future service days from the live boat delay", () => {
    vi.setSystemTime(
      DateTime.fromISO("2026-06-27T20:57:00", {
        zone: "America/Los_Angeles",
      }).toJSDate()
    );
    const slot = makeSlot({
      time: "2026-06-28T05:30:00",
      vesselDelayMins: 6,
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(0);
  });

  it("prefers boat-level delay over stale terminal-specific on-time data", () => {
    const slot = makeSlot({
      delayMins: 0,
      driveUpCapacity: 100,
      time: "2026-06-21T10:00:00",
      vesselDelayMins: 12,
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(12);
  });

  it("uses GPS delay for a passed active sailing with stale terminal data", () => {
    const slot = makeSlot({
      delayMins: 0,
      driveUpCapacity: 100,
      gpsDelayMins: 12,
      hasPassed: true,
      time: "2026-06-21T10:00:00",
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(12);
  });

  it("uses a passed active GPS sailing as the forecast anchor", () => {
    const active = makeSlot({
      driveUpCapacity: 40,
      gpsDelayMins: 17,
      hasPassed: true,
      time: "2026-06-21T10:00:00",
      vesselId: "delayed",
    });
    const next = makeSlot({
      time: "2026-06-21T11:00:00",
      vesselId: "delayed",
    });

    expect(
      getProjectedDelayMins({ schedule: [active, next], slot: next })
    ).toBe(10);
  });

  it("uses GPS delay over recorded terminal and dock delay signals", () => {
    const slot = makeSlot({
      delayMins: 20,
      driveUpCapacity: 100,
      gpsDelayMins: 12,
      time: "2026-06-21T10:00:00",
      vesselDelayMins: 8,
    });

    expect(getProjectedTiming({ schedule: [slot], slot }).delayMins).toBe(12);
  });

  it("projects GPS delay only across the same vessel schedule", () => {
    const current = makeSlot({
      driveUpCapacity: 40,
      gpsDelayMins: 17,
      time: "2026-06-21T10:00:00",
      vesselId: "delayed",
    });
    const nextSameVessel = makeSlot({
      time: "2026-06-21T11:00:00",
      vesselId: "delayed",
    });
    const nextOtherVessel = makeSlot({
      time: "2026-06-21T11:30:00",
      vesselId: "other",
    });

    expect(
      getProjectedDelayMins({
        schedule: [current, nextSameVessel, nextOtherVessel],
        slot: nextSameVessel,
      })
    ).toBe(10);
    expect(
      getProjectedDelayMins({
        schedule: [current, nextSameVessel, nextOtherVessel],
        slot: nextOtherVessel,
      })
    ).toBe(0);
  });

  it("does not project delay across the schedule when vessel id is missing", () => {
    const missingId = makeSlot({
      gpsDelayMins: 20,
      time: "2026-06-21T10:00:00",
      vesselId: null,
    });
    const other = makeSlot({
      time: "2026-06-21T11:00:00",
      vesselId: "other",
    });

    expect(missingId.vessel.id).toBeUndefined();
    expect(
      getProjectedDelayMins({ schedule: [missingId, other], slot: other })
    ).toBe(0);
    expect(
      getProjectedDelayMins({ schedule: [missingId, other], slot: missingId })
    ).toBe(20);
  });

  it("does not apply one boat's delay to another vessel", () => {
    const delayed = makeSlot({
      time: "2026-06-21T10:00:00",
      vesselDelayMins: 20,
      vesselId: "delayed",
    });
    const other = makeSlot({
      time: "2026-06-21T10:30:00",
      vesselId: "other",
    });

    expect(
      getProjectedDelayMins({ schedule: [delayed, other], slot: other })
    ).toBe(0);
  });

  it("recovers less when the previous sailing is more than 70 percent full", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 20,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(12);
  });

  it("recovers the expanded-history ratio after a lighter current sailing", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(12);
  });

  it("does not reset projected delay from later live delay values", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({
      delayMins: 30,
      driveUpCapacity: 40,
      time: "2026-06-21T11:00:00",
    });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(12);
  });

  it("uses forecast fullness when deciding whether the boat recovers", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 20,
      estimateDriveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(12);
  });

  it("uses actual fullness for passed sailings over forecast fullness", () => {
    const slot = makeSlot({
      delayMins: 20,
      driveUpCapacity: 20,
      estimateDriveUpCapacity: 40,
      hasPassed: true,
      time: "2026-06-21T10:00:00",
    });

    expect(getDelayRecoveryMins(20, slot)).toBe(8);
  });

  it("ignores zero-capacity fullness data when projecting a later sailing", () => {
    const current = makeSlot({
      delayMins: 20,
      driveUpCapacity: 0,
      time: "2026-06-21T10:00:00",
      totalCapacity: 0,
    });
    const next = makeSlot({ time: "2026-06-21T11:00:00" });

    const timing = getProjectedTiming({ schedule: [current, next], slot: next });

    expect(timing.delayMins).toBe(12);
    expect(timing.departureTime.isValid).toBe(true);
  });

  it("recovers more delay after longer scheduled crossings", () => {
    const shortCrossing = makeSlot({
      arrivalTime: "2026-06-21T10:20:00",
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });
    const longCrossing = makeSlot({
      arrivalTime: "2026-06-21T11:00:00",
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });

    expect(getDelayRecoveryMins(20, longCrossing)).toBeGreaterThan(
      getDelayRecoveryMins(20, shortCrossing)
    );
  });

  it("uses vessel power to weight as a speed capability input", () => {
    const slowerVessel = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      horsepower: 1400,
      time: "2026-06-21T10:00:00",
      weight: 1000,
    });
    const fasterVessel = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      horsepower: 3400,
      time: "2026-06-21T10:00:00",
      weight: 1000,
    });

    expect(getDelayRecoveryMins(20, fasterVessel)).toBeGreaterThan(
      getDelayRecoveryMins(20, slowerVessel)
    );
  });

  it("does not penalize high wind when expanded history shows no delay effect", () => {
    const calmSlot = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
      weather: { windGustKmh: 18, windSpeedKmh: 10 },
    });
    const windySlot = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
      weather: { windGustKmh: 55, windSpeedKmh: 38 },
    });

    expect(getDelayRecoveryMins(20, windySlot)).toBe(
      getDelayRecoveryMins(20, calmSlot)
    );
  });

  it("never projects an early departure after recovery", () => {
    const first = makeSlot({
      arrivalTime: "2026-06-21T11:00:00",
      delayMins: 2,
      driveUpCapacity: 40,
      horsepower: 3400,
      time: "2026-06-21T10:00:00",
      weight: 1000,
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(0);
  });
});
