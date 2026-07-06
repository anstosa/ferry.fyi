import { describe, expect, it } from "vitest";

import { requireScheduleResponse } from "../../client/lib/schedule";

describe("schedule client helpers", () => {
  // empty response behavior
  it("throws when the API returns no schedule envelope", () => {
    expect(() => requireScheduleResponse(undefined)).toThrow(
      "Schedule response was empty"
    );
  });
});
