import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { Slot } from "shared/contracts/schedules";

import { hasSailingDeparted } from "../../client/views/Schedule/departureState";
import type { ProjectedTiming } from "../../client/views/Schedule/projectedTiming";

const scheduledTime = DateTime.fromISO("2026-08-26T12:00:00", {
  zone: "America/Los_Angeles",
});

// build a live sailing fixture
const makeSlot = ({
  isAtDock,
  liveDepartureTime = scheduledTime,
}: {
  isAtDock: boolean;
  liveDepartureTime?: DateTime;
}): Slot =>
  ({
    hasPassed: true,
    time: scheduledTime.toSeconds(),
    vessel: {
      isAtDock,
      scheduledDepartureTime: liveDepartureTime.toSeconds(),
    },
  }) as Slot;

// build the projected schedule fixture
const makeTiming = (): ProjectedTiming => ({
  delayMins: 0,
  departureTime: scheduledTime,
  isCancelled: false,
  scheduledTime,
});

describe("schedule departure state", () => {
  it("keeps the active sailing current while its vessel is loading", () => {
    expect(
      hasSailingDeparted({
        slot: makeSlot({ isAtDock: true }),
        time: scheduledTime.plus({ minutes: 2 }),
        timing: makeTiming(),
      })
    ).toBe(false);
  });

  it("marks the active sailing departed once its vessel is underway", () => {
    expect(
      hasSailingDeparted({
        slot: makeSlot({ isAtDock: false }),
        time: scheduledTime.minus({ minutes: 1 }),
        timing: makeTiming(),
      })
    ).toBe(true);
  });

  it("uses projected time when live vessel data belongs to another sailing", () => {
    expect(
      hasSailingDeparted({
        slot: makeSlot({
          isAtDock: true,
          liveDepartureTime: scheduledTime.plus({ minutes: 30 }),
        }),
        time: scheduledTime.plus({ minutes: 2 }),
        timing: makeTiming(),
      })
    ).toBe(true);
  });
});
