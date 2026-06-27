import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route } from "../../server/models/Route";

const wsfApi = vi.hoisted(() => ({
  wsfRequest: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/lib/wsf/api", () => wsfApi);

const { updateRoutes } = await import("../../server/lib/wsf/updateRoutes");

// route refresh
describe("updateRoutes", () => {
  // reset route cache
  beforeEach(() => {
    Route.purge();
    wsfApi.wsfRequest.mockReset();
  });

  // static metadata preservation
  it("attaches static galley hours after the route cache has been purged", async () => {
    wsfApi.wsfRequest
      .mockResolvedValueOnce([
        {
          ArrivingTerminalID: 5,
          DepartingTerminalID: 14,
        },
      ])
      .mockResolvedValueOnce([
        {
          CrossingTime: 20,
          Description: "Mukilteo / Clinton",
          RouteAbbrev: "muk-cl",
          RouteID: 7,
        },
      ]);

    await updateRoutes("2026-06-26");

    expect(Route.getByIndex("7")?.serialize()).toMatchObject({
      galleyHours: expect.arrayContaining([
        {
          days: [4, 5, 6, 7],
          endTime: "20:05",
          startTime: "06:30",
          vesselPosition: 2,
        },
      ]),
      terminalIds: ["14", "5"],
    });
  });
});
