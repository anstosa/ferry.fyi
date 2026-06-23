import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { Slot } from "shared/contracts/schedules";

import {
  getProjectedDelayMins,
  getProjectedTiming,
} from "../../client/views/Schedule/projectedTiming";

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const vessel = {
  id: "vessel",
  tallVehicleCapacity: 0,
  vehicleCapacity: 100,
};

// build slot fixture
const makeSlot = ({
  delayMins,
  driveUpCapacity,
  estimateDriveUpCapacity,
  hasPassed = false,
  time,
}: {
  delayMins?: number;
  driveUpCapacity?: number;
  estimateDriveUpCapacity?: number;
  hasPassed?: boolean;
  time: string;
}): Slot =>
  ({
    crossing:
      driveUpCapacity === undefined && delayMins === undefined
        ? undefined
        : {
            departureDelta: delayMins === undefined ? null : delayMins * 60,
            driveUpCapacity: driveUpCapacity ?? 100,
            isCancelled: false,
            reservableCapacity: 0,
            totalCapacity: 100,
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
    vessel,
  }) as Slot;

describe("projected schedule timing", () => {
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

  it("keeps delay when the current sailing is more than 70 percent full", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 20,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(20);
  });

  it("recovers five minutes after a current sailing below 70 percent full", () => {
    const first = makeSlot({
      delayMins: 20,
      driveUpCapacity: 40,
      time: "2026-06-21T10:00:00",
    });
    const second = makeSlot({ time: "2026-06-21T11:00:00" });

    expect(
      getProjectedDelayMins({ schedule: [first, second], slot: second })
    ).toBe(15);
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
    ).toBe(15);
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
    ).toBe(15);
  });
});
