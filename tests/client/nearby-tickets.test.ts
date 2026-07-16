import { describe, expect, it } from "vitest";
import type { Terminal } from "../../shared/contracts/terminals";

import { getNearbyTicketGroups } from "../../client/lib/nearbyTickets";

const terminal = (id: string, routes: Terminal["routes"] = {}): Terminal =>
  ({
    abbreviation: id,
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: false,
    hasWaitingRoom: false,
    id,
    info: {},
    location: { address: {}, latitude: 47, longitude: -122 },
    name: id,
    popularity: 0,
    routes,
    waitTimes: [],
  }) as Terminal;

describe("getNearbyTicketGroups", () => {
  it("includes valid tickets whose route serves the nearby terminal", () => {
    const anacortes = terminal("1", {
      "9": {
        abbreviation: "ana-sj",
        crossingTime: 0,
        date: "",
        description: "Anacortes / San Juan Islands",
        id: "9",
        terminalIds: ["1", "10"],
      },
    });

    expect(
      getNearbyTicketGroups({
        favoriteRouteIds: [],
        location: anacortes.location,
        terminal: anacortes,
        terminals: [anacortes],
        tickets: [
          {
            description: "Anacortes / San Juan Islands vehicle",
            id: "T123",
            status: "Valid",
            type: "ticket",
            usesRemaining: 1,
          },
        ],
      })[0]?.tickets.map((ticket) => ticket.id)
    ).toEqual(["T123"]);
  });

  it("includes reservation accounts only at reservation terminals", () => {
    const anacortes = terminal("1", {
      "9": {
        abbreviation: "ana-sj",
        crossingTime: 0,
        date: "",
        description: "Anacortes / San Juan Islands",
        id: "9",
        terminalIds: ["1", "10"],
      },
    });
    const seattle = terminal("7");

    expect(
      getNearbyTicketGroups({
        favoriteRouteIds: [],
        location: anacortes.location,
        terminal: anacortes,
        terminals: [anacortes, seattle],
        tickets: [{ id: "R123", type: "reservation" }],
      })[0]?.tickets.map((ticket) => ticket.id)
    ).toEqual(["R123"]);

    expect(
      getNearbyTicketGroups({
        favoriteRouteIds: [],
        location: seattle.location,
        terminal: seattle,
        terminals: [anacortes, seattle],
        tickets: [{ id: "R123", type: "reservation" }],
      })
    ).toEqual([]);
  });
});
