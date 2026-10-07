// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FareCatalogDisclosure } from "../../client/components/FareCatalogDisclosure";
import type { FareCurrentCatalogResponse } from "../../shared/contracts/fares";

const response: FareCurrentCatalogResponse = {
  state: "current",
  catalog: {
    kind: "catalog",
    collectionDescription: "Passengers pay westbound only.",
    request: {
      arrivingTerminalId: "3",
      departingTerminalId: "7",
      roundTrip: false,
      tripDate: "2026-07-29",
    },
    freshness: {
      fetchedAt: 1785315600,
      sourceCacheFlushDate: "2026-07-28",
      validFrom: "2026-07-01",
      validThrough: "2026-09-30",
      policyVersion: "policy-test",
    },
    fares: [
      {
        id: 22,
        label: "Adult",
        category: "Passenger",
        amount: 10.5,
        directionIndependent: false,
      },
      {
        id: 11,
        label: "Standard vehicle",
        category: "Vehicle",
        amount: 22.25,
        directionIndependent: true,
      },
    ],
  },
};

describe("full fare catalog disclosure", () => {
  it("includes every ordered row in a closed native disclosure with source context", () => {
    const markup = renderToStaticMarkup(
      <FareCatalogDisclosure
        response={response}
        departingName="Seattle"
        arrivingName="Bainbridge"
      />
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe(
      "Show full fare table"
    );
    expect(
      Array.from(details?.querySelectorAll("tbody tr") ?? []).map((row) =>
        row.getAttribute("data-fare-id")
      )
    ).toEqual(["22", "11"]);
    expect(details?.querySelectorAll("th[scope=col]")).toHaveLength(4);
    expect(markup).toContain("$10.50");
    expect(markup).toContain("$22.25");
    expect(markup).toContain("Passengers pay westbound only.");
    expect(markup).toContain("Seattle to Bainbridge");
    expect(markup).toContain("2026-07-29");
    expect(markup).toContain("one-way");
    expect(markup).toContain("2026-09-30");
    expect(markup).toContain("policy-test");
    expect(markup).toContain("Direction-independent");
  });

  it("preserves the provider no-fare message without an empty table", () => {
    const markup = renderToStaticMarkup(
      <FareCatalogDisclosure
        response={{
          state: "no-fare",
          noFare: {
            kind: "no-fare",
            freshness: response.catalog.freshness,
            request: response.catalog.request,
            message: "No fare collected here.",
            sourceUrl: null,
          },
        }}
      />
    );
    expect(markup).toContain("No fare collected here.");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<table");
  });
});
