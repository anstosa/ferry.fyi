import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/logger", () => ({
  default: { warn: vi.fn() },
}));

const { clearWashingtonHolidayCache, getWashingtonHolidayDates } =
  await import("../../server/lib/holidays");

describe("Washington holiday lookup", () => {
  beforeEach(() => {
    clearWashingtonHolidayCache();
  });

  // global cleanup
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // holiday filter behavior
  it("keeps federal and Washington public holidays", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            counties: null,
            date: "2026-01-01",
            global: true,
            name: "New Year's Day",
            types: ["Public"],
          },
          {
            counties: ["US-WA"],
            date: "2026-11-27",
            global: false,
            name: "Native American Heritage Day",
            types: ["Public"],
          },
          {
            counties: ["US-CA"],
            date: "2026-03-31",
            global: false,
            name: "Cesar Chavez Day",
            types: ["Public"],
          },
          {
            counties: null,
            date: "2026-02-14",
            global: true,
            name: "Valentine's Day",
            types: ["Observance"],
          },
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const holidays = await getWashingtonHolidayDates(2026);

    expect([...holidays]).toEqual(["2026-01-01", "2026-11-27"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://date.nager.at/api/v3/PublicHolidays/2026/US"
    );
  });

  // observed holiday behavior
  it("adds the calendar date for observed fixed-date holidays", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            counties: null,
            date: "2026-07-03",
            global: true,
            name: "Independence Day",
            types: ["Public"],
          },
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const holidays = await getWashingtonHolidayDates(2026);

    expect([...holidays].sort()).toEqual(["2026-07-03", "2026-07-04"]);
  });

  // cache behavior
  it("caches holiday responses by year", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            counties: null,
            date: "2026-01-01",
            global: true,
            name: "New Year's Day",
            types: ["Public"],
          },
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await getWashingtonHolidayDates(2026);
    await getWashingtonHolidayDates(2026);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
