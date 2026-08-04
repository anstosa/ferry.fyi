import { describe, expect, it } from "vitest";

import {
  getLateTextClassName,
  getScheduleLiveSpaceState,
  getScheduleRowClassName,
  getScheduleRowState,
  getScheduleSailingContext,
  getScheduleSpaceClassName,
  getScheduleTimeMajorClassName,
  getScheduleTimeMinorClassName,
} from "../../client/views/Schedule/scheduleColors";

describe("schedule color tokens", () => {
  // daylight context
  it("maps daylight sailings to the day context", () => {
    expect(getScheduleSailingContext({ isDaylight: true })).toBe("day");
  });

  // nighttime context
  it("maps non-daylight sailings to the night context", () => {
    expect(getScheduleSailingContext({ isDaylight: false })).toBe("night");
  });

  // row state priority
  it("gives full rows priority over confirmed capacity rows", () => {
    expect(
      getScheduleRowState({ hasConfirmedCapacity: true, isFull: true })
    ).toBe("full");
  });

  // normal row background
  it("uses day normal row background tokens", () => {
    expect(getScheduleRowClassName("day")).toContain("bg-day-normal-light");
  });

  // confirmed row time
  it("uses night confirmed time tokens", () => {
    expect(getScheduleTimeMajorClassName("night", "confirmed")).toContain(
      "text-white"
    );
    expect(getScheduleTimeMinorClassName("night", "confirmed")).toContain(
      "text-[#b8d5de]"
    );
  });

  // right-side live forecast label
  it("uses normal text when live capacity is extended by a right-side forecast", () => {
    expect(
      getScheduleLiveSpaceState({
        hasForecastExtension: true,
        isFull: false,
        statusSide: "right",
      })
    ).toBe("normal");
  });

  // left-side live forecast label
  it("keeps confirmed text when the live capacity label sits on the fill", () => {
    expect(
      getScheduleLiveSpaceState({
        hasForecastExtension: true,
        isFull: false,
        statusSide: "left",
      })
    ).toBe("confirmed");
  });

  // full live forecast label
  it("keeps full text priority for live forecast labels", () => {
    expect(
      getScheduleLiveSpaceState({
        hasForecastExtension: true,
        isFull: true,
        statusSide: "right",
      })
    ).toBe("full");
  });

  // night forecast capacity text
  it("uses contrast-safe light-mode night capacity text", () => {
    expect(getScheduleSpaceClassName("night", "normal")).toContain(
      "text-[#1f5664]"
    );
  });

  it("uses contrast-safe secondary time tokens", () => {
    expect(getScheduleTimeMinorClassName("day", "normal")).toContain(
      "text-[#5f5f5f]"
    );
    expect(getScheduleTimeMinorClassName("night", "normal")).toContain(
      "text-[#4f6570]"
    );
  });

  it("keeps confirmed night capacity readable in light mode", () => {
    expect(getScheduleSpaceClassName("night", "confirmed")).toContain(
      "text-[#1f5664]"
    );
  });

  // full capacity text
  it("uses full day badge text tokens", () => {
    expect(getScheduleSpaceClassName("day", "full")).toContain(
      "text-[#7a5400]"
    );
  });

  // late text
  it("uses theme-specific late tokens", () => {
    expect(getLateTextClassName()).toBe("text-late-light dark:text-late-dark");
  });
});
