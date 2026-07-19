import { describe, expect, it } from "vitest";

import {
  FareCatalog,
  FareNoFare,
  FareQuote,
  WSDOT_FARE_API_CAPABILITIES,
  WSDOT_FARE_SERVER_ENV_KEYS,
} from "../../shared/contracts/fares";
import {
  validateRedactedWsdotFareFixture,
  validateWsdotFareLineItems,
  validateWsdotFareTotals,
} from "../../shared/lib/fares";
import { redactedWsdotFareFixture } from "./fixtures/wsdot-fares";

describe("fare contracts and WSDOT source validation", () => {
  const freshness = { fetchedAt: 1_700_000_000, sourceCacheFlushDate: null };
  const request = {
    arrivingTerminalId: "3",
    departingTerminalId: "1",
    roundTrip: false,
    tripDate: "2026-07-18" as const,
  };

  it("validates the documented WSDOT line-item and total response shapes", () => {
    expect(
      validateWsdotFareLineItems(redactedWsdotFareFixture.fareLineItems)
    ).toEqual({
      ok: true,
      value: redactedWsdotFareFixture.fareLineItems,
    });
    expect(
      validateWsdotFareTotals(redactedWsdotFareFixture.fareTotals)
    ).toEqual({
      ok: true,
      value: redactedWsdotFareFixture.fareTotals,
    });
    expect(
      validateWsdotFareTotals([
        { ...redactedWsdotFareFixture.fareTotals[0], TotalType: 4 },
      ])
    ).toMatchObject({ ok: true });
  });

  it("rejects malformed WSDOT source data instead of treating it as a fare", () => {
    expect(
      validateWsdotFareLineItems([
        { ...redactedWsdotFareFixture.fareLineItems[0], Amount: -1 },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateWsdotFareTotals([
        { ...redactedWsdotFareFixture.fareTotals[0], TotalType: "Unknown" },
      ])
    ).toMatchObject({ ok: false });
  });

  it("models catalog, priced quote, and no-fare responses as distinct results", () => {
    const catalog: FareCatalog = {
      collectionDescription: "Fare collected on departure.",
      fares: [
        {
          amount: 9.25,
          category: "Passenger",
          directionIndependent: true,
          id: 101,
          label: "Adult (age 19 - 64)",
        },
      ],
      freshness,
      kind: "catalog",
      request,
    };
    const quote: FareQuote = {
      freshness,
      kind: "quote",
      request: {
        ...request,
        lineItems: [{ fareLineItemId: 101, quantity: 1 }],
      },
      totals: [
        {
          amount: 9.25,
          briefDescription: "Total",
          description: "Total fare",
          type: "total",
        },
      ],
    };
    const noFare: FareNoFare = {
      freshness,
      kind: "no-fare",
      message: redactedWsdotFareFixture.noFare.NoFareCollectedMsg,
      request,
    };

    expect(catalog.fares).toHaveLength(1);
    expect(quote.totals[0].type).toBe("total");
    expect(noFare.message).toContain("No fare");
  });

  it("publishes machine-readable upstream capabilities without credentials", () => {
    expect(WSDOT_FARE_API_CAPABILITIES).toMatchObject({
      credential: { exposure: "server-only", queryParameter: "apiaccesscode" },
      endpoints: {
        fareLineItems: {
          requiresApiAccessCode: true,
          response: "fare-line-items",
        },
        fareTotals: { requiresApiAccessCode: true, response: "fare-totals" },
      },
      source: "wsdot-fares-rest",
    });
    expect(WSDOT_FARE_SERVER_ENV_KEYS).toEqual(["WSDOT_API_KEY"]);
  });

  it("keeps fixture data free of credential-bearing fields", () => {
    expect(validateRedactedWsdotFareFixture(redactedWsdotFareFixture)).toEqual({
      ok: true,
      value: redactedWsdotFareFixture,
    });
    expect(
      validateRedactedWsdotFareFixture({ apiaccesscode: "do-not-store" })
    ).toMatchObject({ ok: false });
  });
});
