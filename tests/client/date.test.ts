import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { toAddedDateString } from "../../client/lib/date";

describe("added date formatting", () => {
  const now = DateTime.fromISO("2026-08-05T12:00:00", {
    zone: "America/Los_Angeles",
  });

  it("special-cases today and yesterday", () => {
    expect(toAddedDateString(now.minus({ hour: 3 }), now)).toBe("today");
    expect(toAddedDateString(now.minus({ day: 1 }), now)).toBe("yesterday");
  });

  it("omits the year for other dates in the current year", () => {
    expect(toAddedDateString(DateTime.fromISO("2026-02-14"), now)).toBe(
      "Feb 14"
    );
  });

  it("includes the year for dates outside the current year", () => {
    expect(toAddedDateString(DateTime.fromISO("2025-12-31"), now)).toBe(
      "Dec 31, 2025"
    );
  });
});
