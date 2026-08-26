import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/lib/forecast", () => ({
  updateEstimates: vi.fn(),
}));

const { applyForecastSnapshots, serializeForecastSchedules } =
  await import("../../server/lib/forecastIsolation");

describe("forecast isolation", () => {
  // preserve a plain worker payload
  it("serializes cached schedules without model instances", () => {
    const schedule = {
      serialize: () => ({
        date: "2026-08-26",
        key: "5-14-2026-08-26",
        mateId: "14",
        slots: [{ hasPassed: false, mateId: "14", time: 123 }],
        terminalId: "5",
        validRange: null,
      }),
    } as never;

    const result = serializeForecastSchedules([schedule]);

    expect(result).toEqual([
      expect.objectContaining({
        key: "5-14-2026-08-26",
        slots: [expect.objectContaining({ time: 123 })],
      }),
    ]);
  });

  // merge results by stable identities
  it("applies only matching schedule and sailing snapshots", () => {
    const matchingSlot = { time: 123 };
    const staleSlot = { time: 456, weather: { existing: true } };
    const schedule = {
      key: "5-14-2026-08-26",
      slots: [matchingSlot, staleSlot],
    } as never;
    const estimate = {
      driveUpCapacity: 20,
      reservableCapacity: 0,
    };

    applyForecastSnapshots(
      [schedule],
      [
        {
          key: "5-14-2026-08-26",
          slots: [{ estimate, time: 123 }],
        },
        {
          key: "stale-schedule",
          slots: [{ estimate, time: 456 }],
        },
      ]
    );

    expect(matchingSlot).toEqual(
      expect.objectContaining({ estimate, tide: undefined, weather: undefined })
    );
    expect(staleSlot).toEqual({ time: 456, weather: { existing: true } });
  });
});
