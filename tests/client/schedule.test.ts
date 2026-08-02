import { describe, expect, it } from "vitest";

import {
  getScheduleCheckedAt,
  requireScheduleResponse,
} from "../../client/lib/schedule";

describe("schedule client helpers", () => {
  // empty response behavior
  it("throws when the API returns no schedule envelope", () => {
    expect(() => requireScheduleResponse(undefined)).toThrow(
      "Schedule response was empty"
    );
  });

  it("keeps the response timestamp separate from source freshness", () => {
    const response = {
      schedule: {
        date: "2026-08-02",
        key: "3-7-2026-08-02",
        mateId: "7",
        slots: [],
        sourceUpdatedAt: 1,
        terminalId: "3",
        validRange: null,
      },
      timestamp: 2_000_000_000,
    };

    expect(getScheduleCheckedAt(response)).toBe(2_000_000_000);
    expect(requireScheduleResponse(response).schedule.sourceUpdatedAt).toBe(1);
  });

  it("does not invent a check time for legacy responses", () => {
    const response = {
      schedule: {} as never,
      timestamp: undefined as never,
    };

    expect(getScheduleCheckedAt(response)).toBeNull();
  });
});
