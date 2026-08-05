import { describe, expect, it } from "vitest";

import {
  getSavedTicketCode,
  getSavedTicketLookupId,
  getTicketDisplayInfo,
  getTicketLookupId,
  getTicketProductKind,
  getWave2GoTicketLookupUrl,
  parseSavedTicketCode,
  parseTicketText,
} from "../../shared/lib/tickets";

// ticket display parsing

describe("ticket display helpers", () => {
  it("keeps unresolved ticket products unknown", () => {
    expect(getTicketProductKind({})).toBe("unknown");
  });

  it("classifies a ticket only after identifying details load", () => {
    expect(getTicketProductKind({ usesRemaining: 1 })).toBe("single-ride");
    expect(getTicketProductKind({ usesRemaining: 10 })).toBe("multi-ride");
    expect(
      getTicketProductKind({
        description: "Seattle / Bainbridge Multi-Ride",
        usesRemaining: 1,
      })
    ).toBe("multi-ride");
  });

  it("extracts a lookup ID and links to the current manual lookup page", () => {
    const scannedUrl =
      "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890";
    expect(getTicketLookupId(scannedUrl)).toBe("1234567890");
    expect(getWave2GoTicketLookupUrl()).toBe(
      "https://wave2go.wsdot.com/webstore/landingPage?c=76&cg=21"
    );
  });

  it("extracts lookup IDs from account-synced QR references", () => {
    const scannedUrl =
      "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890";
    expect(getSavedTicketLookupId(`qr:${encodeURIComponent(scannedUrl)}`)).toBe(
      "1234567890"
    );
    expect(getSavedTicketLookupId("9876543210")).toBe("9876543210");
  });

  it("round-trips account-synced ticket references", () => {
    const scannedUrl =
      "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890";
    const savedCode = getSavedTicketCode(scannedUrl, "qr");

    expect(parseSavedTicketCode(savedCode)).toEqual({
      code: scannedUrl,
      codeFormat: "qr",
    });
    expect(parseSavedTicketCode("9876543210")).toEqual({
      code: "9876543210",
      codeFormat: "barcode",
    });
  });

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
