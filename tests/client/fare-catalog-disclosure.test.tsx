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

// inspect one provider label in initial HTML
const renderLabel = (label: string): HTMLDivElement => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <FareCatalogDisclosure
      response={{
        ...response,
        catalog: {
          ...response.catalog,
          fares: [
            {
              id: 1,
              label,
              category: "Passenger",
              amount: 5.65,
              directionIndependent: false,
            },
          ],
        },
      }}
    />
  );
  return container;
};

describe("full fare catalog disclosure", () => {
  // retain route context and every fare without secondary paragraphs
  it("includes every ordered row in a closed native disclosure with only route context", () => {
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
    expect(
      Array.from(details?.querySelectorAll("th[scope=col]") ?? []).map(
        (heading) => heading.textContent
      )
    ).toEqual(["Fare", "Price"]);
    expect(details?.querySelectorAll("tbody td")).toHaveLength(2);
    expect(markup).toContain("$10.50");
    expect(markup).toContain("$22.25");
    expect(details?.querySelectorAll("p")).toHaveLength(1);
    expect(markup).toContain("Seattle to Bainbridge");
    expect(markup).toContain("2026-07-29");
    expect(markup).toContain("one-way");
  });

  // zero-priced catalog rows use the same wording as the standard comparisons
  it("labels zero-dollar line items as free without currency-code text", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <FareCatalogDisclosure
        response={{
          ...response,
          catalog: {
            ...response.catalog,
            fares: response.catalog.fares.map((fare) => ({
              ...fare,
              amount: 0,
            })),
          },
        }}
      />
    );
    expect(
      [...container.querySelectorAll("tbody td")].map(
        (cell) => cell.textContent
      )
    ).toEqual(["Free", "Free"]);
    expect(container.textContent).not.toMatch(/USD|\$0\.00/);
  });

  // convert the provider's unquoted link without adopting active attributes
  it("renders official provider links as safe anchors in initial HTML", () => {
    const href =
      "https://wsdot.wa.gov/ferries/rider-information/ada#Reduced%20fare%20passenger%20tickets";
    const container = renderLabel(
      `Senior / <a href=${href} target="_self" onclick="alert(1)">Disability</a>`
    );
    const link = container.querySelector("tbody a");

    expect(container.querySelector("tbody th")?.textContent).toBe(
      "Senior / Disability"
    );
    expect(link?.getAttribute("href")).toBe(href);
    expect(link?.textContent).toBe("Disability");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.hasAttribute("onclick")).toBe(false);
  });

  // keep quoted and relative URLs deterministic across render runtimes
  it.each([
    [
      '"https://wsdot.wa.gov/fares?first=1&amp;second=2"',
      "https://wsdot.wa.gov/fares?first=1&second=2",
    ],
    [
      "'/ferries/rider-information/ada'",
      "https://wsdot.wa.gov/ferries/rider-information/ada",
    ],
  ])("decodes safe provider links from %s", (href, expected) => {
    const container = renderLabel(
      `Senior / <a href=${href}><strong>Disability &amp; eligibility</strong></a>`
    );

    expect(container.querySelector("tbody a")?.getAttribute("href")).toBe(
      expected
    );
    expect(container.querySelector("tbody a")?.textContent).toBe(
      "Disability & eligibility"
    );
    expect(container.querySelector("tbody strong")).toBeNull();
  });

  // keep active URL schemes inert even when entity encoded
  it.each([
    // eslint-disable-next-line no-script-url -- exercise blocked provider URLs
    "javascript:alert(1)",
    // eslint-disable-next-line no-script-url -- exercise blocked provider URLs
    "JaVaScRiPt:alert(1)",
    "&#106;avascript:alert(1)",
    "java&#x09;script:alert(1)",
    "data:text/html,<svg/onload=alert(1)>",
    "vbscript:alert(1)",
  ])("rejects unsafe provider link %s", (href) => {
    const container = renderLabel(`<a href="${href}">Disability</a>`);

    expect(container.querySelector("tbody a")).toBeNull();
    expect(container.querySelector("tbody th")?.textContent).toBe("Disability");
  });

  // exclude source HTML outside supported link text
  it("does not render active markup or infer href from another attribute", () => {
    const container = renderLabel(
      'Youth <img src=x onerror="alert(1)"> <script>alert(1)</script> <a title="href=https://wsdot.wa.gov/">Disability</a>'
    );

    expect(
      container.querySelector("tbody img, tbody script, tbody a")
    ).toBeNull();
    expect(container.querySelector("tbody th")?.textContent).toContain("Youth");
    expect(container.querySelector("tbody th")?.textContent).toContain(
      "Disability"
    );
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
