import type { Slot } from "shared/contracts/schedules";
import { describe, expect, it } from "vitest";

import {
  formatFeetBelowAverageLowTide,
  formatTideLevel,
  getSlotLowestTideLevel,
  getTidalCancellationRisk,
} from "../../client/views/Schedule/tidalCancellationRisk";

// build risk slot fixture
const makeSlot = ({
  arrivalWaterLevelM,
  hasPassed = false,
  isCancelled = false,
  cancellationReason,
  mateId = "17",
  waterLevelM,
}: {
  arrivalWaterLevelM?: number | null;
  cancellationReason?: Slot["cancellationReason"];
  hasPassed?: boolean;
  isCancelled?: boolean;
  mateId?: string;
  waterLevelM?: number | null;
}): Slot =>
  ({
    cancellationReason,
    crossing: { isCancelled },
    hasPassed,
    mateId,
    tide: {
      arrivalWaterLevelM,
      stationId: "9444900",
      waterLevelM: waterLevelM ?? null,
    },
    vessel: {},
  }) as Slot;

describe("tidal cancellation risk", () => {
  // formatting behavior
  it("formats predicted tide levels", () => {
    expect(formatTideLevel(-0.634)).toBe("-0.63m MLLW");
  });

  // feet formatting behavior
  it("formats predicted tide depth below average low tide", () => {
    expect(formatFeetBelowAverageLowTide(-0.72)).toBe("2.4ft");
  });

  // inch formatting behavior
  it("formats shallow predicted tide depth below average low tide in inches", () => {
    expect(formatFeetBelowAverageLowTide(-0.2)).toBe("8in");
  });

  // lowest tide behavior
  it("uses the lower of departure and arrival tide predictions", () => {
    const slot = makeSlot({ arrivalWaterLevelM: -0.72, waterLevelM: 0.1 });

    expect(getSlotLowestTideLevel(slot)).toBe(-0.72);
  });

  // threshold behavior
  it("marks future low-tide sailings on sensitive routes as risks", () => {
    const slot = makeSlot({ waterLevelM: -0.72 });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })
    ).toMatchObject({
      explanation:
        "This sailing is likely to be cancelled; tide forecast is " +
        "2.4ft below the average low tide. WSF typically cancels for low " +
        "tides at that level on this route.",
      title: "Tidal cancellation risk",
      tideLevelM: -0.72,
    });
  });

  // route behavior
  it("does not mark low-tide sailings on insensitive routes", () => {
    const slot = makeSlot({ mateId: "3", waterLevelM: -0.72 });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "7", slot })
    ).toBeNull();
  });

  // non-tidal cancellation behavior
  it("shows a reason card for non-tidal cancelled sailings", () => {
    const slot = makeSlot({ isCancelled: true, waterLevelM: -0.72 });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })
    ).toMatchObject({
      explanation:
        "WSF has cancelled this sailing for a reason other than tidal " +
        "conditions. See route alerts for more.",
      title: "Sailing Cancelled",
      tideLevelM: -0.72,
    });
  });

  // past non-tidal cancellation behavior
  it("shows a reason card for past non-tidal cancelled sailings", () => {
    const slot = makeSlot({
      hasPassed: true,
      isCancelled: true,
      waterLevelM: -0.72,
    });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })?.title
    ).toBe("Sailing Cancelled");
  });

  // confirmed tidal cancellation behavior
  it("shows a reason card for confirmed tidal cancellations", () => {
    const slot = makeSlot({
      cancellationReason: "tidal",
      hasPassed: true,
      isCancelled: true,
      waterLevelM: -0.72,
    });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })
    ).toMatchObject({
      explanation:
        "WSF has cancelled this sailing due to tidal conditions; " +
        "tide was 2.4ft below the average low tide.",
      title: "Tidal cancellation",
      tideLevelM: -0.72,
    });
  });

  // future confirmed tidal cancellation behavior
  it("uses forecast wording for future confirmed tidal cancellations", () => {
    const slot = makeSlot({
      cancellationReason: "tidal",
      hasPassed: false,
      isCancelled: true,
      waterLevelM: -0.72,
    });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })?.explanation
    ).toContain("tide forecast is 2.4ft");
  });

  // past sailing behavior
  it("does not show risk for past sailings", () => {
    const slot = makeSlot({ hasPassed: true, waterLevelM: -0.72 });

    expect(
      getTidalCancellationRisk({ departureTerminalId: "11", slot })
    ).toBeNull();
  });
});
