import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  getNextSsrSailingDayBoundary,
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

  it("finds DST-correct spring and fall local boundaries", () => {
    expect(
      DateTime.fromJSDate(
        getNextSsrSailingDayBoundary(
          DateTime.fromISO("2026-03-08T00:30:00", { zone: SAILING_DAY_ZONE })
        )
      )
        .setZone(SAILING_DAY_ZONE)
        .toISO()
    ).toBe("2026-03-08T03:00:00.000-07:00");
    expect(
      DateTime.fromJSDate(
        getNextSsrSailingDayBoundary(
          DateTime.fromISO("2026-11-01T01:30:00", { zone: SAILING_DAY_ZONE })
        )
      )
        .setZone(SAILING_DAY_ZONE)
        .toISO()
    ).toBe("2026-11-01T03:00:00.000-08:00");
  });
});
