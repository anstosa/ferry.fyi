import { DateTime } from "luxon";
import type { TravelMode } from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import {
  getBoardingRule,
  isRecommendationDirection,
} from "shared/data/boardingRules";
import ROUTES from "shared/data/route-terminal-ids.json";
import {
  getCapacityWatermark,
  getRecommendationServiceDate,
  getSailingRecommendationRevision,
} from "shared/lib/sailingRecommendationRevision";
import { describe, expect, it } from "vitest";

// construct a minimal material-revision fixture
const makeSchedule = (): Schedule => ({
  key: "14-5-2026-10-03",
  date: "2026-10-03",
  terminalId: "14",
  mateId: "5",
  validRange: null,
  slots: [
    {
      time: 1800002400,
      allowsPassengers: true,
      allowsVehicles: true,
      hasPassed: false,
      mateId: "5",
      wuid: "test",
      vessel: {
        id: "1",
        name: "test",
        vehicleCapacity: 100,
        tallVehicleCapacity: 0,
      },
    } as Slot,
  ],
});

describe("sailing recommendation domain rules", () => {
  // distinguish fetch freshness from actual sailing changes
  it("keeps a material revision through unchanged schedule refreshes", () => {
    const schedule = makeSchedule();
    schedule.sourceUpdatedAt = 1_800_000_000;
    const revision = getSailingRecommendationRevision(schedule);
    schedule.sourceUpdatedAt += 60;
    expect(getSailingRecommendationRevision(schedule)).toBe(revision);
  });

  // keep all domestic route families explicit and exclude unsupported international trips
  it("covers domestic directional pairs and all four modes with advice rather than invented gates", () => {
    for (const { terminalIds } of Object.values(ROUTES)) {
      // check both directions within every supported route family
      for (const departureId of terminalIds) {
        for (const arrivalId of terminalIds.filter(
          (id) => id !== departureId
        )) {
          // keep advice separate from the adjustable buffer and reserved-vehicle rules
          for (const mode of [
            "drive",
            "walk",
            "bicycle",
            "transit",
          ] as TravelMode[]) {
            const rule = getBoardingRule(departureId, arrivalId, mode);
            expect(rule?.cutoffSeconds).toBe(0);
            expect(rule?.advisorySeconds).toBe(
              mode === "drive" || mode === "bicycle" ? 1200 : 300
            );
            expect(rule?.sourceUrl).toMatch(/^https:\/\/wsdot\.wa\.gov\//);
          }
        }
      }
    }
    expect(isRecommendationDirection("14", "14")).toBe(false);
    expect(isRecommendationDirection("14", "16")).toBe(false);
    expect(isRecommendationDirection("1", "19")).toBe(false);
    expect(getBoardingRule("unknown", "5", "drive")).toBeNull();
  });
  // preserve the 3am Pacific service-day boundary through daylight-saving changes
  it("uses Pacific service dates before and after 3am including DST fallback", () => {
    for (const day of ["2026-10-03", "2026-11-01"]) {
      const start = DateTime.fromISO(`${day}T03:00:00`, {
        zone: "America/Los_Angeles",
      });
      expect(getRecommendationServiceDate(start.toSeconds())).toBe(day);
      expect(
        getRecommendationServiceDate(start.minus({ seconds: 1 }).toSeconds())
      ).toBe(start.minus({ days: 1 }).toISODate());
    }
  });
  // invalidate bands for every user-visible departure or capacity mutation
  it("ignores unused weather but invalidates displayed vessels, timing and inventory", () => {
    const schedule = makeSchedule();
    const original = getSailingRecommendationRevision(schedule);
    expect(
      getSailingRecommendationRevision({
        ...schedule,
        slots: [
          {
            ...schedule.slots[0],
            weather: { temperatureC: 15 },
          } as Slot,
        ],
      })
    ).toBe(original);
    // cover the displayed identity and projected delay recovery inputs
    for (const patch of [
      { cancellationReason: "tidal" },
      { arrivalTime: 1800003600 },
      { vessel: { ...schedule.slots[0].vessel, name: "renamed" } },
      { vessel: { ...schedule.slots[0].vessel, horsepower: 1000 } },
      { vessel: { ...schedule.slots[0].vessel, weight: 800 } },
      { vessel: { ...schedule.slots[0].vessel, vehicleCapacity: 120 } },
      { vessel: { ...schedule.slots[0].vessel, isAtDock: false } },
      { allowsVehicles: false },
      { hasPassed: true },
      { time: 1800002460 },
      { estimate: { driveUpCapacity: 0, reservableCapacity: null } },
      { crossing: { capacityReportUpdatedAt: 1800000000, driveUpCapacity: 0 } },
    ]) {
      expect(
        getSailingRecommendationRevision({
          ...schedule,
          slots: [{ ...schedule.slots[0], ...patch } as Slot],
        })
      ).not.toBe(original);
    }
    expect(getCapacityWatermark(schedule)).toBeNull();
    schedule.slots[0].crossing = {
      capacityReportUpdatedAt: 1800000000,
    } as Slot["crossing"];
    expect(getCapacityWatermark(schedule)).toBe(1800000000);
  });
});
