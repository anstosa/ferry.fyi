import type { Schedule, Slot } from "../../shared/contracts/schedules";
import type { Vessel } from "../../shared/contracts/vessels";
import { describe, expect, it } from "vitest";
import {
  getMapSailingPath,
  getNextVesselSailing,
  getVesselMapPath,
} from "../../client/lib/vesselMapLinks";

const vessel = { id: "vessel-1" } as Vessel;

// sailing fixture
const sailing = (
  time: number,
  vesselId = vessel.id,
  isCancelled = false
): Slot =>
  ({
    crossing: { isCancelled },
    time,
    vessel: { id: vesselId },
  }) as Slot;

const schedule = {
  date: "2026-09-01",
  slots: [
    sailing(900),
    sailing(1200, vessel.id, true),
    sailing(1500),
    sailing(1100, "other-vessel"),
  ],
} as Schedule;

describe("vessel map links", () => {
  // focused map url
  it("builds a focused map path without carrying sailing detail state", () => {
    expect(getVesselMapPath("/clinton/mukilteo/", vessel.id)).toBe(
      "/clinton/mukilteo/map?vessel=vessel-1"
    );
  });

  // next active assignment
  it("finds the next non-cancelled sailing assigned to the vessel", () => {
    expect(getNextVesselSailing(schedule, vessel.id, 1000)?.time).toBe(1500);
  });

  // sailing detail url
  it("builds the canonical encoded schedule deep link from a map sailing", () => {
    expect(
      getMapSailingPath({
        mapPathname: "/clinton/mukilteo/map",
        sailing: sailing(1500),
        schedule,
        tab: "sailing",
      })
    ).toBe("/clinton/mukilteo?date=2026-09-01&sailing=1500&tab=sailing");
  });
});
