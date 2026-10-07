import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  getSsrRefreshWindow,
  SSR_REFRESH_WINDOW_ZONE,
} from "../../shared/lib/ssrRefreshWindow";

// build one pacific test instant
const pacific = (value: string) =>
  DateTime.fromISO(value, { zone: SSR_REFRESH_WINDOW_ZONE });

describe("SSR refresh window", () => {
  it("changes at the fixed 03:00 and 15:00 local boundaries", () => {
    const beforeMorning = getSsrRefreshWindow(
      pacific("2026-01-15T02:59:59.999")
    );
    const morning = getSsrRefreshWindow(pacific("2026-01-15T03:00:00.000"));
    const beforeAfternoon = getSsrRefreshWindow(
      pacific("2026-01-15T14:59:59.999")
    );
    const afternoon = getSsrRefreshWindow(pacific("2026-01-15T15:00:00.000"));

    expect(beforeMorning.id).toBe("2026-01-14T15:00");
    expect(beforeMorning.classification).toBe("15:00");
    expect(beforeMorning.start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(beforeMorning.end.toISOString()).toBe("2026-01-15T11:00:00.000Z");
    expect(morning.id).toBe("2026-01-15T03:00");
    expect(morning.classification).toBe("03:00");
    expect(beforeAfternoon.id).toBe(morning.id);
    expect(afternoon.id).toBe("2026-01-15T15:00");
  });

  it("uses local calendar boundaries across daylight-saving transitions", () => {
    const spring = getSsrRefreshWindow(pacific("2026-03-07T15:00:00.000"));
    const fall = getSsrRefreshWindow(pacific("2026-10-31T15:00:00.000"));

    expect(spring.end.getTime() - spring.start.getTime()).toBe(
      11 * 60 * 60 * 1000
    );
    expect(fall.end.getTime() - fall.start.getTime()).toBe(13 * 60 * 60 * 1000);
  });
});
