import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleModel = vi.hoisted(() => ({
  generateKey: vi.fn(),
  getByIndex: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/Crossing", () => ({
  default: {},
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Terminal", () => ({
  Terminal: { getAll: vi.fn() },
}));

vi.mock("~/models/Vessel", () => ({
  Vessel: { getByIndex: vi.fn() },
}));

vi.mock("~/lib/wsf/api", () => ({
  wsfRequest: vi.fn(),
}));

const { getPreviousCrossing } = await import("../../server/lib/wsf/updateSchedules");

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

describe("schedule update helpers", () => {
  // reset schedule mocks
  beforeEach(() => {
    scheduleModel.generateKey.mockReset();
    scheduleModel.getByIndex.mockReset();
    scheduleModel.generateKey.mockReturnValue("1-2-2026-06-21");
  });

  // previous crossing lookup
  it("returns the preceding scheduled crossing in numeric departure order", () => {
    const firstCrossing = { id: "first" };
    const secondCrossing = { id: "second" };
    const firstTime = toSeconds("2026-06-21T09:00:00");
    const secondTime = toSeconds("2026-06-21T10:00:00");
    const laterTime = toSeconds("2026-06-21T11:00:00");
    scheduleModel.getByIndex.mockReturnValue({
      getSlot: (departureTime: number) => {
        // first slot guard
        if (departureTime === firstTime) {
          return { crossing: firstCrossing };
        }
        // second slot guard
        if (departureTime === secondTime) {
          return { crossing: secondCrossing };
        }
        return null;
      },
      slots: [
        { crossing: secondCrossing, time: secondTime },
        { crossing: firstCrossing, time: firstTime },
        { time: laterTime },
      ],
    });

    expect(getPreviousCrossing("1", "2", laterTime)).toBe(secondCrossing);
  });
});
