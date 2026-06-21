import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { getDaylightWindow, isDuringDaylight } from "../../client/lib/daylight";

const seattleTerminalLocation = {
  latitude: 47.60249,
  longitude: -122.33987,
  address: {},
};

// daylight model tests
describe("client daylight model", () => {
  // summer window check
  it("approximates summer daylight around Seattle", () => {
    const day = DateTime.fromISO("2026-06-21T12:00:00", {
      zone: "America/Los_Angeles",
    });
    const { sunrise, sunset } = getDaylightWindow(
      day,
      seattleTerminalLocation
    );

    expect(sunrise.hour).toBeGreaterThanOrEqual(4);
    expect(sunrise.hour).toBeLessThanOrEqual(6);
    expect(sunset.hour).toBeGreaterThanOrEqual(20);
    expect(sunset.hour).toBeLessThanOrEqual(22);
  });

  // daylight boolean check
  it("separates daytime sailings from nighttime sailings", () => {
    const daytime = DateTime.fromISO("2026-06-21T12:00:00", {
      zone: "America/Los_Angeles",
    });
    const nighttime = DateTime.fromISO("2026-06-21T01:00:00", {
      zone: "America/Los_Angeles",
    });

    expect(isDuringDaylight(daytime, seattleTerminalLocation)).toBe(true);
    expect(isDuringDaylight(nighttime, seattleTerminalLocation)).toBe(false);
  });
});
