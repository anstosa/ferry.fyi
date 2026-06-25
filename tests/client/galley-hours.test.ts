import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { Route } from "../../shared/contracts/routes";
import type { Slot } from "../../shared/contracts/schedules";

import { getGalleyStatus } from "../../client/views/Schedule/galleyHours";

const route = {
  abbreviation: "test",
  crossingTime: 30,
  date: "",
  description: "Test",
  galleyHours: [
    { days: [3], endTime: "10:00", startTime: "08:00", vesselPosition: 1 },
  ],
  id: "route",
  terminalIds: ["a", "b"],
} satisfies Route;

const slot = {
  vesselPosition: 1,
} as Slot;

// galley status
describe("getGalleyStatus", () => {
  // open window
  it("marks the galley open during the selected sailing window", () => {
    expect(
      getGalleyStatus({
        route,
        sailingTime: DateTime.fromISO("2026-06-24T09:00:00"),
        slot,
      })
    ).toBe("open");
  });

  // closed window
  it("marks the galley closed outside the selected sailing window", () => {
    expect(
      getGalleyStatus({
        route,
        sailingTime: DateTime.fromISO("2026-06-24T11:00:00"),
        slot,
      })
    ).toBe("closed");
  });

  // missing data
  it("returns unknown without structured hours", () => {
    expect(
      getGalleyStatus({
        route: undefined,
        sailingTime: DateTime.fromISO("2026-06-24T09:00:00"),
        slot,
      })
    ).toBe("unknown");
  });
});
