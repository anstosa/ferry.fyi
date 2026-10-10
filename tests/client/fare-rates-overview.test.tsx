// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FareLoadingContent } from "../../client/components/FareLoadingContent";
import { FareRatesOverview } from "../../client/components/FareRatesOverview";
import { parseFareWizardConfig } from "../../client/lib/fareWizard";
import type {
  FareCurrentCatalogResponse,
  FareDefaultRate,
  FareNoFareResponse,
} from "../../shared/contracts/fares";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const freshness = {
  fetchedAt: 1791475200,
  policyVersion: "fixture",
  sourceCacheFlushDate: "2026-10-08",
  validFrom: "2026-10-08" as const,
  validThrough: "2027-03-20" as const,
};

// retain independent source state for each displayed amount
const rate = (
  amount: number,
  state: FareDefaultRate["state"] = "current"
): FareDefaultRate => ({ amount, freshness, state });

const response: FareCurrentCatalogResponse = {
  state: "current",
  catalog: {
    kind: "catalog",
    fares: [],
    collectionDescription: null,
    freshness,
    request: {
      departingTerminalId: "7",
      arrivingTerminalId: "3",
      tripDate: "2026-10-08",
      roundTrip: true,
    },
  },
  defaultRates: {
    passenger: { oneWay: rate(11.35), roundTrip: rate(11.35) },
    standardVehicle: { oneWay: rate(20.25), roundTrip: rate(40.5) },
  },
};

// model the live fare module reading the router location after lazy resolution
const LiveFareMount = (): React.ReactElement => {
  const location = useLocation();
  const config = parseFareWizardConfig(location.search);
  return (
    <output
      data-router-location={`${location.pathname}${location.search}${location.hash}`}
      data-router-state={JSON.stringify(location.state)}
    >
      {config.travelMode ?? "no mode"}
    </output>
  );
};

// switch from the lightweight fallback to the router-driven live view
const FallbackToLiveHarness = (): React.ReactElement => {
  const [live, setLive] = React.useState(false);
  if (live) {
    return <LiveFareMount />;
  }
  return (
    <>
      <FareLoadingContent
        arrivingName="Bainbridge"
        departingName="Seattle"
        tripDate="2026-10-08"
      />
      <button onClick={() => setLive(true)} type="button">
        Mount live fare calculator
      </button>
    </>
  );
};

// inspect the same server-safe common fare content used before hydration
const render = (
  value: FareCurrentCatalogResponse | FareNoFareResponse = response
): HTMLDivElement => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <FareRatesOverview
      response={value}
      departingName="Seattle"
      arrivingName="Bainbridge"
    />
  );
  return container;
};

describe("FareRatesOverview", () => {
  // keep route and choice copy visible while only official amounts remain unknown
  it("loads only the four unknown standard fare amounts", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <FareRatesOverview
        arrivingName="Bainbridge"
        departingName="Seattle"
        loadingTripDate="2026-10-08"
      />
    );

    expect(container.querySelector("h1")?.textContent).toBe(
      "Seattle to Bainbridge ferry fares"
    );
    expect(container.textContent).toContain("October 8, 2026");
    expect(container.textContent).toContain("Passenger");
    expect(container.textContent).toContain("Standard vehicle & driver");
    expect(container.textContent?.match(/One way/g)).toHaveLength(2);
    expect(container.textContent?.match(/Round trip/g)).toHaveLength(2);
    expect(
      container.querySelector('[aria-label="Loading fare prices"]')
    ).not.toBeNull();
    expect(
      container.querySelectorAll('.skeleton[aria-hidden="true"]')
    ).toHaveLength(4);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "#custom-fare-calculator"
    );
    expect(container.querySelector("nav a")?.classList).toContain(
      "bg-green-dark"
    );
  });

  // the real page and pending prices share the same route tools and custom action
  it.each([true, false])(
    "keeps all fare planning buttons visible while loading: %s",
    (loading) => {
      const container = document.createElement("div");
      const sourceProps = loading
        ? { loadingTripDate: "2026-10-08" }
        : { response };
      container.innerHTML = renderToStaticMarkup(
        <MemoryRouter>
          <FareRatesOverview
            {...sourceProps}
            arrivingName="Bainbridge"
            departingName="Seattle"
            mate={{ id: "3" }}
            terminal={{ id: "7" }}
          />
        </MemoryRouter>
      );
      const links = [
        ...container.querySelectorAll(
          'nav[aria-label="Fare planning links"] a'
        ),
      ];
      // stable route titles use the common font without a category eyebrow
      expect(container.querySelector("h1")?.className).toBe(
        "text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white"
      );
      expect(container.querySelector("h1")?.previousElementSibling).toBeNull();
      expect(container.textContent).not.toContain("Common ferry fares");
      expect(links).toHaveLength(7);
      expect(links[5]?.textContent).toBe("Calculate a custom fare");
      expect(links[5]?.classList).toContain("bg-green-dark");
      expect(links[5]?.getAttribute("href")).toBe("#custom-fare-calculator");
      expect(links[5]?.closest('[aria-busy="true"]')).toBeNull();
      // show both standard rate sections before the planning buttons
      const navigation = links[0]?.closest("nav");
      const passenger = container.querySelector(
        '[aria-labelledby="fare-passenger-heading"]'
      )!;
      const vehicle = container.querySelector(
        '[aria-labelledby="fare-vehicle-heading"]'
      )!;
      expect(navigation).not.toBeNull();
      expect(
        passenger.compareDocumentPosition(navigation!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(
        vehicle.compareDocumentPosition(navigation!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(container.querySelectorAll(".skeleton")).toHaveLength(
        loading ? 4 : 0
      );
    }
  );

  // match the lazy fallback to the unboxed page without hiding static controls
  it("renders static calculator content outside the loading price region", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <FareLoadingContent
          arrivingName="Bainbridge"
          departingName="Seattle"
          tripDate="2026-10-08"
        />
      </MemoryRouter>
    );

    const calculator = container.querySelector("#custom-fare-calculator");
    expect(calculator?.textContent).toContain("Calculate a custom fare");
    expect(calculator?.textContent).toContain("How are you traveling?");
    expect(calculator?.textContent).toContain("Vehicle");
    expect(calculator?.textContent).toContain("Bicycle");
    expect(calculator?.textContent).toContain("Walk on");
    expect(calculator?.querySelectorAll("button")).toHaveLength(3);
    expect(calculator?.querySelector("button:disabled")).toBeNull();
    expect(calculator?.querySelector(".skeleton")).toBeNull();
    expect(calculator?.className).not.toMatch(/rounded|border|bg-|shadow/);
  });

  // retain safe first-step input until the full calculator bundle mounts
  it("persists a loading-state travel choice without waiting for prices", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/seattle/fare?date=2026-10-08#custom-fare-calculator",
          ]}
        >
          <FareLoadingContent
            arrivingName="Bainbridge"
            departingName="Seattle"
            tripDate="2026-10-08"
          />
          <LiveFareMount />
        </MemoryRouter>
      );
    });
    const bicycle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Bicycle"
    );

    act(() => bicycle?.click());

    const output = container.querySelector("output");
    const routerLocation = output?.getAttribute("data-router-location") ?? "";
    const search = new URL(routerLocation, "https://example.com").searchParams;
    expect(search.get("date")).toBe("2026-10-08");
    expect(search.get("fareMode")).toBe("bicycle");
    expect(routerLocation).toContain("#custom-fare-calculator");
    act(() => root.unmount());
  });

  // keep the router location and state authoritative across lazy replacement
  it("carries a fallback choice into the live fare mount", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={[
            {
              hash: "#custom-fare-calculator",
              pathname: "/seattle/fare",
              search: "?date=2026-10-08",
              state: { source: "fixture" },
            },
          ]}
        >
          <FallbackToLiveHarness />
        </MemoryRouter>
      );
    });
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label
      );

    act(() => button("Bicycle")?.click());
    act(() => button("Mount live fare calculator")?.click());

    const output = container.querySelector("output");
    const routerLocation = output?.getAttribute("data-router-location") ?? "";
    expect(output?.textContent).toBe("bicycle");
    expect(
      new URL(routerLocation, "https://example.com").searchParams.get("date")
    ).toBe("2026-10-08");
    expect(routerLocation).toContain("#custom-fare-calculator");
    expect(output?.getAttribute("data-router-state")).toBe(
      JSON.stringify({ source: "fixture" })
    );
    act(() => root.unmount());
  });

  // provide both standard choices without interaction
  it("shows source totals, route, date and the custom calculator jump", () => {
    const container = render();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Seattle to Bainbridge ferry fares"
    );
    expect(container.textContent).toContain("October 8, 2026");
    expect(container.querySelectorAll("h2")).toHaveLength(2);
    expect(container.textContent).toContain("One adult walk-on · ages 19–64");
    expect(container.textContent).toContain(
      "one full-fare driver · no extra passengers"
    );
    expect(container.textContent).toContain("One way$20.25");
    expect(container.textContent).toContain("Round trip$40.50");
    expect(container.textContent).toContain("Round trip$11.35");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "#custom-fare-calculator"
    );
    expect(container.querySelectorAll("time[datetime]")).toHaveLength(1);
    expect(container.textContent).not.toMatch(
      /USD|One way leaves|Source fetched|Source time unavailable|Official WSDOT quote/
    );
  });

  // standard fare sections keep their headings but lose their outer card treatments
  it("removes top-level card shells without changing price comparisons", () => {
    const container = render();
    const sections = [
      container.querySelector("h1")?.parentElement,
      ...container.querySelectorAll(
        '[aria-labelledby="fare-passenger-heading"], [aria-labelledby="fare-vehicle-heading"]'
      ),
    ];
    // price tiles are nested content rather than top-level shells
    sections.forEach((section) => {
      expect(section).not.toBeNull();
      expect(section?.className).not.toMatch(
        /rounded|\bborder\b|bg-|\bp[xy]?-\d/
      );
    });
    expect(container.textContent).toContain("$20.25");
  });

  // a missing quote does not imply zero or doubled catalog pricing
  it("keeps missing summaries explicitly unavailable", () => {
    const container = render({ ...response, defaultRates: undefined });
    expect(container.textContent?.match(/Unavailable/g)).toHaveLength(4);
    expect(container.textContent).not.toContain("$0.00");
    expect(container.querySelectorAll("time")).toHaveLength(1);
  });

  // preserve independently stale state without the removed source timestamps
  it("keeps stale warnings without displaying source timestamps", () => {
    const container = render({
      ...response,
      defaultRates: {
        passenger: {
          oneWay: rate(0),
          roundTrip: {
            ...rate(11.35, "stale"),
            freshness: { ...freshness, fetchedAt: 1791388800 },
          },
        },
        standardVehicle: response.defaultRates!.standardVehicle,
      },
    });
    const passenger = container.querySelector(
      '[aria-labelledby="fare-passenger-heading"]'
    );
    expect(passenger?.textContent).toContain("One wayFree");
    expect(passenger?.textContent).toContain("Stale fare · verify with WSDOT");
    expect(passenger?.querySelector("time")).toBeNull();
    expect(passenger?.textContent).not.toContain("Source");
    expect(container.textContent?.match(/Stale fare/g)).toHaveLength(1);
  });

  // a free departure never establishes a free return
  it("labels explicit no-fare departures without claiming a free round trip", () => {
    const container = render({
      state: "no-fare",
      noFare: {
        kind: "no-fare",
        request: response.catalog.request,
        freshness,
        message: "No departure fare collected.",
        sourceUrl: null,
      },
    });
    expect(container.textContent?.match(/One wayFree/g)).toHaveLength(2);
    expect(container.textContent?.match(/Round tripUnavailable/g)).toHaveLength(
      2
    );
    expect(container.textContent).toContain(
      "The return journey may still have a fare."
    );
    expect(container.textContent).not.toContain("$0.00");
    // keep the no-fare explanation with the rates above the planning buttons
    const navigation = container.querySelector("nav")!;
    expect(navigation.previousElementSibling?.textContent).toContain(
      "The return journey may still have a fare."
    );
  });
});
