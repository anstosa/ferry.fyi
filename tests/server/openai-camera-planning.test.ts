import { describe, expect, it } from "vitest";

import {
  aggregateOpenaiCameraLanes,
  getOpenaiCameraDefinitions,
  getOpenaiCameraQueueEvidence,
  getOpenaiCameraSlot,
  getOpenaiPredepartureSlot,
} from "../../server/lib/openaiCameraPlanning";
import { OPENAI_CAMERA_SCHEDULE_MINUTES } from "../../server/lib/openaiCameraSchedule";
import type {
  OpenaiCameraImageResult,
  OpenaiCameraOccupancy,
} from "../../server/lib/openaiCameraTypes";

// build visible annotated sections
const image = (
  states: (OpenaiCameraOccupancy | null)[],
  passing = false
): OpenaiCameraImageResult => ({
  cameraId: "9166",
  visibilityProblems: false,
  // preserve supplied section identity
  lanes: states.map((occupancyState, index) => ({
    cameraId: "9166",
    laneId: String(index),
    skippedDueToVisibility: occupancyState === null,
    occupancyState,
    passing: occupancyState === null ? null : passing,
  })),
});

// lock slot and lane-combination product rules
describe("OpenAI camera planning", () => {
  // keep scheduler ticks aligned with the approved eligibility slots
  it("schedules every five-minute clock boundary", () => {
    expect(OPENAI_CAMERA_SCHEDULE_MINUTES).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
  });

  // protect the final user correction
  it("resets eligibility on clock slots rather than elapsed cooldown", () => {
    const at = Date.UTC(2026, 9, 23, 10);
    expect(getOpenaiCameraSlot(at + 60_000)).toBe(at);
    expect(getOpenaiCameraSlot(at + 4 * 60_000)).toBe(at);
    expect(getOpenaiCameraSlot(at + 5 * 60_000)).toBe(at + 5 * 60_000);
  });

  // require the tick strictly before predicted departure
  it("uses the previous tick for both exact and off-boundary departures", () => {
    const at = Date.UTC(2026, 9, 23, 10);
    expect(getOpenaiPredepartureSlot(at + 3 * 60_000)).toBe(at);
    expect(getOpenaiPredepartureSlot(at + 10 * 60_000)).toBe(at + 5 * 60_000);
    expect(getOpenaiPredepartureSlot(at + 18 * 60_000)).toBe(at + 15 * 60_000);
  });

  // retain reviewed camera enablement and explicit split-lane identity
  it("groups Clinton lane sections including the irregular lane-six ID", () => {
    const definitions = getOpenaiCameraDefinitions();
    expect(definitions).toHaveLength(8);
    expect(
      definitions.find(({ cameraId }) => cameraId === "9944")
    ).toBeUndefined();
    const holding = definitions.find(({ cameraId }) => cameraId === "9166")!;
    expect(holding.physicalLanes).toHaveLength(7);
    expect(
      holding.physicalLanes.find(({ laneId }) => laneId.endsWith("_6"))
    ).toEqual({
      laneId: "clinton_holding_lane_6",
      sectionIds: [
        "clinton_clinton_terminal_holding_lane_6_front",
        "clinton_clinton_terminal_queue_lane_6",
      ],
    });
    const paired = definitions.filter(({ cameraId }) =>
      ["9394", "9728"].includes(cameraId)
    );
    expect(paired[0].markerId).toBe(paired[1].markerId);
  });

  const values: OpenaiCameraOccupancy[] = ["empty", "low", "high", "full"];
  const expected = [
    ["empty", "low", "low", "high"],
    ["low", "low", "low", "high"],
    ["low", "low", "high", "high"],
    ["high", "high", "high", "full"],
  ];

  // verify all equal-weight front/back combinations
  for (const [frontIndex, front] of values.entries()) {
    // verify both orientations instead of taking the fullest section
    for (const [backIndex, back] of values.entries()) {
      // exercise the documented lookup table
      it(`combines ${front} front and ${back} back`, () => {
        const definition = {
          ...getOpenaiCameraDefinitions()[0],
          cameraId: "9166",
          physicalLanes: [{ laneId: "combined", sectionIds: ["0", "1"] }],
        };
        expect(
          aggregateOpenaiCameraLanes(definition, image([front, back]))
        ).toEqual([
          {
            cameraId: "9166",
            laneId: "combined",
            sectionIds: ["0", "1"],
            occupancyState: expected[frontIndex][backIndex],
            skippedDueToVisibility: false,
          },
        ]);
      });
    }
  }

  // never treat an unobservable half as empty
  it("keeps combined occupancy unknown if a required section is hidden", () => {
    const definition = {
      ...getOpenaiCameraDefinitions()[0],
      physicalLanes: [{ laneId: "combined", sectionIds: ["0", "1"] }],
    };
    expect(
      aggregateOpenaiCameraLanes(definition, image(["full", null]))[0]
    ).toMatchObject({ occupancyState: null, skippedDueToVisibility: true });
  });

  // preserve positive queue evidence in mixed scenes
  it("distinguishes stopped queues, passing traffic and unknown visibility", () => {
    expect(getOpenaiCameraQueueEvidence(image(["high"], true))).toBe("clear");
    expect(getOpenaiCameraQueueEvidence(image([null]))).toBe("unknown");
    expect(getOpenaiCameraQueueEvidence(image(["empty"]))).toBe("clear");
    expect(getOpenaiCameraQueueEvidence(image(["low", null]))).toBe("queued");
    const mixed = image(["high", "low"]);
    mixed.lanes[0].passing = true;
    expect(getOpenaiCameraQueueEvidence(mixed)).toBe("queued");
  });
});
