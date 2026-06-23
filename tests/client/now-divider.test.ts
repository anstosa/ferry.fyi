import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { Slot } from "shared/contracts/schedules";

import {
  getCurrentSlot,
  shouldRenderNowDivider,
} from "../../client/views/Schedule/nowDivider";

// build minimal slot
const makeSlot = (time: string, hasPassed = false): Slot =>
  ({
    hasPassed,
    time: DateTime.fromISO(time, { zone: "America/Los_Angeles" }).toSeconds(),
  }) as Slot;

// add live delay
const withDelay = (slot: Slot, delayMins: number): Slot =>
  ({
    ...slot,
    crossing: {
      departureDelta: delayMins * 60,
      driveUpCapacity: 100,
      isCancelled: false,
      reservableCapacity: 0,
      totalCapacity: 200,
    },
  }) as Slot;

// now divider boundary
describe("shouldRenderNowDivider", () => {
  // boundary case
  it("renders before the next departure based on the client clock", () => {
    const schedule = [
      makeSlot("2026-06-23T10:00:00"),
      makeSlot("2026-06-23T10:30:00"),
      makeSlot("2026-06-23T11:00:00"),
    ];
    const time = DateTime.fromISO("2026-06-23T10:35:00", {
      zone: "America/Los_Angeles",
    });

    expect(
      shouldRenderNowDivider({ schedule, slot: schedule[2], time })
    ).toBe(true);
  });

  // stale server flag case
  it("ignores stale hasPassed flags when choosing the next sailing", () => {
    const schedule = [
      makeSlot("2026-06-23T10:00:00", false),
      makeSlot("2026-06-23T10:30:00", false),
      makeSlot("2026-06-23T11:00:00", false),
    ];
    const time = DateTime.fromISO("2026-06-23T10:35:00", {
      zone: "America/Los_Angeles",
    });

    expect(getCurrentSlot(schedule, time)).toBe(schedule[2]);
  });

  // delayed live sailing case
  it("keeps the now line before a delayed sailing that has not departed", () => {
    const delayedSlot = withDelay(makeSlot("2026-06-23T10:00:00", true), 45);
    const schedule = [
      delayedSlot,
      makeSlot("2026-06-23T10:30:00", false),
      makeSlot("2026-06-23T11:00:00", false),
    ];
    const time = DateTime.fromISO("2026-06-23T10:35:00", {
      zone: "America/Los_Angeles",
    });

    expect(getCurrentSlot(schedule, time)).toBe(delayedSlot);
  });

  // past row case
  it("does not render before a previous sailing", () => {
    const schedule = [
      makeSlot("2026-06-23T10:00:00"),
      makeSlot("2026-06-23T10:30:00"),
    ];
    const time = DateTime.fromISO("2026-06-23T10:35:00", {
      zone: "America/Los_Angeles",
    });

    expect(
      shouldRenderNowDivider({ schedule, slot: schedule[0], time })
    ).toBe(false);
  });

  // first row case
  it("does not render before the first sailing", () => {
    const schedule = [makeSlot("2026-06-23T10:00:00")];
    const time = DateTime.fromISO("2026-06-23T09:35:00", {
      zone: "America/Los_Angeles",
    });

    expect(
      shouldRenderNowDivider({ schedule, slot: schedule[0], time })
    ).toBe(false);
  });
});
