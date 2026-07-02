import { describe, expect, it } from "vitest";

import {
  getTicketDisplayInfo,
  parseTicketText,
} from "../../shared/lib/tickets";

// ticket display parsing

describe("ticket display helpers", () => {
  // bracket marker route case
  it("strips bracket markers and moves route prefixes into a route name", () => {
    expect(parseTicketText("[T] Mu-Cl Adult Passenger")).toEqual({
      routeName: "Mukilteo / Clinton",
      text: "Adult Passenger",
    });
  });

  // item marker abbreviation case
  it("strips suffix markers and expands fare abbreviations", () => {
    expect(parseTicketText("An-FH Adult Psgr (T)")).toEqual({
      routeName: "Anacortes / Friday Harbor",
      text: "Adult Passenger",
    });
  });

  // vehicle abbreviation case
  it("expands vehicle length abbreviations and strips ride counts", () => {
    expect(parseTicketText("Vehicle U14' & Driver 20 Ride")).toEqual({
      text: "Vehicle Under 14' & Driver",
    });
  });

  // commuter count case
  it("strips numeric ride counts from commuter pass titles", () => {
    expect(parseTicketText("Passenger Commuter 10 Ride")).toEqual({
      text: "Passenger Commuter",
    });
  });

  // monthly count case
  it("strips other numeric ride counts from pass titles", () => {
    expect(parseTicketText("WSF Monthly Pass 31 Rides")).toEqual({
      text: "WSF Monthly Pass",
    });
  });

  // full route prefix case
  it("moves full route names into the route chip", () => {
    expect(parseTicketText("Seattle / Bainbridge Multi-Ride")).toEqual({
      routeName: "Seattle / Bainbridge Island",
      text: "Multi-Ride",
    });
  });

  // duplicate subtitle case
  it("falls back to PLU when the subtitle matches the title", () => {
    expect(
      getTicketDisplayInfo({
        description: "[T] Mu-Cl Adult Passenger",
        fallbackTitle: "WSF single-ride pass",
        name: "Adult Psgr (T)",
        plu: "ABC123",
      })
    ).toEqual({
      routeName: "Mukilteo / Clinton",
      subtitle: "ABC123",
      title: "Adult Passenger",
    });
  });
});
