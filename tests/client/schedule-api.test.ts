import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    data: unknown;

    constructor(status: number, data: unknown) {
      super(`API request failed with status ${status}`);
      this.status = status;
      this.data = data;
    }
  }

  return { ApiError, get: vi.fn() };
});

vi.mock("~/lib/api", () => api);

import { getSchedule } from "../../client/lib/schedule";

describe("getSchedule", () => {
  it("retries a schedule while the server refreshes it", async () => {
    vi.useFakeTimers();
    const response = { schedule: { slots: [] }, timestamp: 1 };
    api.get
      .mockRejectedValueOnce(
        new api.ApiError(503, { body: { status: "refreshing" } })
      )
      .mockResolvedValueOnce(response);

    const schedule = getSchedule(
      { id: "8" } as never,
      { id: "12" } as never,
      DateTime.fromISO("2026-07-14")
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(schedule).resolves.toEqual(response);
    expect(api.get).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries the unwrapped refreshing response", async () => {
    vi.useFakeTimers();
    const response = { schedule: { slots: [] }, timestamp: 1 };
    api.get
      .mockRejectedValueOnce(new api.ApiError(503, { status: "refreshing" }))
      .mockResolvedValueOnce(response);

    const schedule = getSchedule({ id: "8" } as never, { id: "12" } as never);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(schedule).resolves.toEqual(response);
    vi.useRealTimers();
  });
});
