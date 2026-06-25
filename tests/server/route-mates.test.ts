import { beforeEach, describe, expect, it } from "vitest";

import { Route } from "../../server/models/Route";
import { Terminal } from "../../server/models/Terminal";

// route mate sorting
describe("Route.getMatesByTerminalId", () => {
  // reset model cache
  beforeEach(() => {
    Route.purge();
    Terminal.purge();
  });

  // save terminal fixture
  const saveTerminal = (id: string, name: string): void => {
    new Terminal({ id, name }).save();
  };

  // alphabetical mates
  it("returns mate terminals alphabetically by name", () => {
    saveTerminal("source", "Source");
    saveTerminal("vashon", "Vashon");
    saveTerminal("anacortes", "Anacortes");
    saveTerminal("mukilteo", "Mukilteo");
    new Route({
      abbreviation: "test",
      crossingTime: 0,
      date: "2026-06-22",
      description: "Test route",
      id: "route",
      terminalIds: ["source", "vashon", "anacortes", "mukilteo"],
    }).save();

    const mateNames = Route.getMatesByTerminalId("source").map(({ name }) => {
      // expose names
      return name;
    });

    expect(mateNames).toEqual(["Anacortes", "Mukilteo", "Vashon"]);
  });

  // route capacity serialization
  it("serializes normal vehicle capacity when the updater has set it", () => {
    const route = new Route({
      abbreviation: "test",
      crossingTime: 0,
      date: "2026-06-22",
      description: "Test route",
      id: "route",
      galleyHours: [
        { days: [1], endTime: "10:00", startTime: "09:00", vesselPosition: 1 },
      ],
      normalVehicleCapacity: 262,
      normalVehicleMaxCapacity: 202,
      terminalIds: ["source", "mate"],
    });

    expect(route.serialize()).toMatchObject({
      galleyHours: [
        { days: [1], endTime: "10:00", startTime: "09:00", vesselPosition: 1 },
      ],
      normalVehicleCapacity: 262,
      normalVehicleMaxCapacity: 202,
    });
  });
});
