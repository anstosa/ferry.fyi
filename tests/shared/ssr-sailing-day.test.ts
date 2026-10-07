import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  getSsrSailingDayId,
  SAILING_DAY_ZONE,
} from "../../shared/lib/ssrSailingDay";

describe("SSR sailing day", () => {
  it("uses the previous local calendar day before 03:00", () => {
    expect(
      getSsrSailingDayId(
        DateTime.fromISO("2026-07-28T02:59:59", { zone: SAILING_DAY_ZONE })
      )
    ).toBe("2026-07-27");
    expect(
      getSsrSailingDayId(
        DateTime.fromISO("2026-07-28T03:00:00", { zone: SAILING_DAY_ZONE })
      )
    ).toBe("2026-07-28");
  });
});
