import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { getDemandCalendarProfile } from "../../server/lib/demandCalendar";
import { parseOspiSchoolBreakRanges } from "../../server/lib/demandEvents/updateSchoolBreakEvents";

const at = (iso: string): DateTime =>
  DateTime.fromISO(iso, { zone: "America/Los_Angeles" });

describe("demand calendar", () => {
  // school break pressure
  it("adds pressure during state-level school breaks", () => {
    const profile = getDemandCalendarProfile({
      arrivalId: "5",
      departureId: "14",
      time: at("2026-04-10T09:00:00"),
    });

    expect(profile.schoolBreakPressure).toBeGreaterThan(0);
    expect(profile.totalPressure).toBeGreaterThan(0);
  });

  // event-backed school break pressure
  it("prefers persisted school break events over static dates", () => {
    const profile = getDemandCalendarProfile({
      arrivalId: "5",
      departureId: "14",
      events: [
        {
          endsAt: at("2026-03-14T23:59:59").toSeconds(),
          eventType: "school-break",
          location: "washington-state",
          pressure: 0.12,
          source: "test",
          sourceId: "break",
          startsAt: at("2026-03-10T00:00:00").toSeconds(),
          title: "Washington school break",
        } as any,
      ],
      time: at("2026-03-12T09:00:00"),
    });

    expect(profile.schoolBreakPressure).toBe(0.12);
  });

  // OSPI parser
  it("extracts common OSPI school break ranges", () => {
    const ranges = parseOspiSchoolBreakRanges(
      [
        "District/Entity First Day of School Winter Break Mid-Winter Break Spring Break Last Day of School",
        "A District 9/2/2025 12/22/2025-1/2/2026 2/17/2026-2/20/2026 4/6/26-4/10/26 6/16/2026",
        "B District 9/2/2025 12/22/2025-1/2/2026 2/17/2026-2/20/2026 4/6/26-4/10/26 6/16/2026",
        "C District 9/2/2025 12/21/2025-1/5/2026 3/5/2026-3/6/2026 3/30/26-4/3/26 6/16/2026",
      ].join(" "),
      2025
    );

    expect(ranges.map((range) => range.kind)).toEqual([
      "winter",
      "mid-winter",
      "spring",
    ]);
    expect(ranges[0].start.toISODate()).toBe("2025-12-22");
    expect(ranges[2].end.toISODate()).toBe("2026-04-10");
  });

  // summer weekend directionality
  it("adds outbound summer weekend pressure from gateway terminals", () => {
    const outbound = getDemandCalendarProfile({
      arrivalId: "5",
      departureId: "14",
      time: at("2026-07-10T16:00:00"),
    });
    const reverse = getDemandCalendarProfile({
      arrivalId: "14",
      departureId: "5",
      time: at("2026-07-10T16:00:00"),
    });

    expect(outbound.summerWeekendPressure).toBeGreaterThan(0);
    expect(reverse.summerWeekendPressure).toBe(0);
  });

  // sports event pressure
  it("adds sports pressure around Seattle home games", () => {
    const startsAt = at("2026-07-10T19:00:00").toSeconds();
    const profile = getDemandCalendarProfile({
      arrivalId: "7",
      departureId: "3",
      events: [
        {
          endsAt: at("2026-07-10T23:00:00").toSeconds(),
          eventType: "sports",
          location: "seattle-stadium",
          pressure: 0.1,
          source: "test",
          sourceId: "game",
          startsAt,
          title: "Seattle home game",
        } as any,
      ],
      time: at("2026-07-10T17:00:00"),
    });

    expect(profile.sportsEventPressure).toBeGreaterThan(0);
  });
});
