import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { toWsfDate, wsfDateToTimestamp } from "~/lib/wsf/date";

// group WSF date parsing
describe("WSF date parsing", () => {
  // verify public seconds contract
  it("parses real-shaped WSF dates as epoch seconds", () => {
    expect(wsfDateToTimestamp("/Date(1784836800000-0700)/")).toBe(1784836800);
  });

  it("uses the Pacific service date for a UTC timestamp", () => {
    const time = DateTime.fromISO("2026-07-15T02:30:00.000Z");

    expect(toWsfDate(time)).toBe("2026-07-14");
  });

  it("uses the previous Pacific service date before 3 AM", () => {
    const time = DateTime.fromISO("2026-07-15T09:30:00.000Z");

    expect(toWsfDate(time)).toBe("2026-07-14");
  });
});
