import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { describe, expect, it } from "vitest";

import {
  getForecastLateText,
  getRoundedEtaMinutes,
  isAfterCurrentSlot,
  roundStatusNumber,
} from "../../client/views/Schedule/vesselStatus";

// vessel status formatting
describe("vessel status formatting", () => {
  // eta rounding
  it("rounds ETA minutes to the nearest whole number", () => {
    const time = DateTime.fromISO("2026-06-24T12:00:00", {
      zone: "America/Los_Angeles",
    });

    expect(
      getRoundedEtaMinutes(time.plus({ minutes: 22.6 }).toSeconds(), time)
    ).toBe(23);
  });

  // status number rounding
  it("rounds status numbers to whole numbers", () => {
    expect(roundStatusNumber(12.49)).toBe(12);
    expect(roundStatusNumber(12.5)).toBe(13);
  });

  // future delay label
  it("labels future vessel delays as forecasts", () => {
    expect(getForecastLateText(12.5)).toBe("Forecast 13 mins late");
    expect(getForecastLateText(0)).toBeNull();
  });

  // future slot check
  it("identifies sailings after the current one", () => {
    const slots = [{ time: 1000 }, { time: 2000 }, { time: 3000 }] as Slot[];

    expect(
      isAfterCurrentSlot({
        currentSlot: slots[1],
        schedule: slots,
        slot: slots[2],
      })
    ).toBe(true);
    expect(
      isAfterCurrentSlot({
        currentSlot: slots[1],
        schedule: slots,
        slot: slots[1],
      })
    ).toBe(false);
  });
});
