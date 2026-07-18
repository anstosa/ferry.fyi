/**
 * Sanitized WSDOT fare REST examples. These fixtures intentionally contain no
 * request URL, API access code, authorization header, or environment value.
 */
export const redactedWsdotFareFixture = {
  fareLineItems: [
    {
      Amount: 9.25,
      Category: "Passenger",
      DirectionIndependent: true,
      FareLineItem: "Adult (age 19 - 64)",
      FareLineItemID: 101,
    },
  ],
  fareTotals: [
    {
      Amount: 9.25,
      BriefDescription: "Total",
      Description: "Total fare",
      TotalType: "Total",
    },
  ],
  noFare: {
    IsNoFareCollected: true,
    NoFareCollectedMsg: "No fare is collected in this direction.",
  },
} as const;
