import { describe, expect, it } from "vitest";

import type { FareLineItem, FareQuote } from "../../shared/contracts/fares";
import {
  getDefaultFareSelections,
  getQuotedFareRates,
} from "../../shared/lib/fareDefaults";

const fares: FareLineItem[] = [
  {
    id: 1,
    label: "Adult (age 19 - 64)",
    amount: 11.35,
    category: "Passenger",
    directionIndependent: false,
  },
  {
    id: 2,
    label: "Vehicle Under 22' (standard veh) & Driver",
    amount: 40.5,
    category: "Vehicle",
    directionIndependent: false,
  },
  {
    id: 3,
    label: "Vehicle U22' & Sr/Disability Driver",
    amount: 34.8,
    category: "Vehicle",
    directionIndependent: false,
  },
];

// represent official round-trip totals for a standard vehicle with one driver
const quote = (overrides: Partial<FareQuote> = {}): FareQuote => ({
  kind: "quote",
  request: {
    arrivingTerminalId: "3",
    departingTerminalId: "7",
    lineItems: [{ fareLineItemId: 2, quantity: 1 }],
    roundTrip: true,
    tripDate: "2026-10-08",
  },
  freshness: {
    fetchedAt: 1791482400,
    policyVersion: "fixture",
    sourceCacheFlushDate: "generation",
    validFrom: "2026-10-08",
    validThrough: "2027-03-20",
  },
  totals: [
    {
      type: "depart",
      amount: 20.25,
      description: "Depart",
      briefDescription: "Depart",
    },
    {
      type: "return",
      amount: 20.25,
      description: "Return",
      briefDescription: "Return",
    },
    {
      type: "total",
      amount: 40.5,
      description: "Grand total",
      briefDescription: "Total",
    },
  ],
  ...overrides,
});

describe("default fare comparisons", () => {
  // choose one full-fare adult or one vehicle-and-driver item
  it("selects standard defaults without adding another adult for the driver", () => {
    expect(getDefaultFareSelections(fares, "passenger")).toEqual([
      { fareLineItemId: 1, quantity: 1 },
    ]);
    expect(getDefaultFareSelections(fares, "standardVehicle")).toEqual([
      { fareLineItemId: 2, quantity: 1 },
    ]);
  });

  // do not guess when source rows are absent or ambiguous
  it("rejects missing, duplicate, reduced and malformed default rows", () => {
    expect(getDefaultFareSelections([fares[2]], "standardVehicle")).toBeNull();
    expect(
      getDefaultFareSelections([fares[0], { ...fares[0], id: 4 }], "passenger")
    ).toBeNull();
    expect(
      getDefaultFareSelections([{ ...fares[0], id: 0 }], "passenger")
    ).toBeNull();
    expect(
      getDefaultFareSelections(
        [{ ...fares[0], label: "Adult multi-ride pass" }],
        "passenger"
      )
    ).toBeNull();
  });

  // compare the official departure and complete journey rather than catalog arithmetic
  it("uses exact source leg and total amounts with their own freshness", () => {
    const source = quote();
    const comparison = getQuotedFareRates(source, "current");
    expect(comparison.oneWay).toEqual({
      amount: 20.25,
      freshness: source.freshness,
      state: "current",
    });
    expect(comparison.roundTrip?.amount).toBe(40.5);
    expect(fares[1].amount).toBe(40.5);
  });

  // return-only passenger collection still has an explicit zero departure amount
  it("preserves a zero departure fare without zeroing the round trip", () => {
    const source = quote({
      totals: [
        {
          type: "depart",
          amount: 0,
          description: "Depart",
          briefDescription: "Depart",
        },
        {
          type: "return",
          amount: 11.35,
          description: "Return",
          briefDescription: "Return",
        },
        {
          type: "total",
          amount: 11.35,
          description: "Total",
          briefDescription: "Total",
        },
      ],
    });
    expect(getQuotedFareRates(source, "current").oneWay?.amount).toBe(0);
    expect(getQuotedFareRates(source, "current").roundTrip?.amount).toBe(11.35);
  });

  // a total alone never implies a one-way leg for a round-trip quote
  it("does not halve totals or infer an either-direction charge", () => {
    const source = quote({
      totals: [
        {
          type: "either",
          amount: 10,
          description: "Either",
          briefDescription: "Either",
        },
        {
          type: "total",
          amount: 20,
          description: "Total",
          briefDescription: "Total",
        },
      ],
    });
    expect(getQuotedFareRates(source, "current").oneWay).toBeNull();
    expect(getQuotedFareRates(source, "current").roundTrip?.amount).toBe(20);
  });

  // retain stale labels and do not promote historical numbers to current
  it("keeps stale source state for both amounts", () => {
    const comparison = getQuotedFareRates(quote(), "stale");
    expect(comparison.oneWay?.state).toBe("stale");
    expect(comparison.roundTrip?.state).toBe("stale");
  });

  // quote mode determines which total is actually supported
  it("handles one-way-only source totals without inventing a return", () => {
    const source = quote();
    source.request.roundTrip = false;
    expect(getQuotedFareRates(source, "current").oneWay?.amount).toBe(40.5);
    expect(getQuotedFareRates(source, "current").roundTrip).toBeNull();
  });

  // malformed or duplicate rows must not leak invalid monetary values
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid amounts: %s",
    (amount) => {
      const source = quote();
      source.totals[0].amount = amount;
      expect(getQuotedFareRates(source, "current").oneWay).toBeNull();
      source.totals.push({ ...source.totals[2] });
      expect(getQuotedFareRates(source, "current").roundTrip).toBeNull();
    }
  );
});
