// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TerminalOverview } from "../../client/components/TerminalOverview";

type Terminal = React.ComponentProps<typeof TerminalOverview>["terminal"];
const terminal: Terminal = {
  abbreviation: "SEA",
  hasElevator: true,
  hasFood: true,
  hasOverheadLoading: true,
  hasRestroom: true,
  hasWaitingRoom: false,
  id: "7",
  info: {
    ada: "Ask staff for accessible boarding assistance.",
    airport: "Airport connection instructions.",
    bicycle: "Bicycle boarding instructions.",
    construction: "Construction advisory.",
    food: "Food vendor details.",
    lost: "Lost property instructions.",
    motorcycle: "Motorcycle boarding instructions.",
    parking: "Nearby paid parking; check operator rates.",
    security: "Security instructions.",
    train: "Train connection instructions.",
    truck: "Truck boarding instructions.",
  },
  location: {
    address: {
      line1: "801 Alaskan Way",
      city: "Seattle",
      state: "WA",
      zip: "98104",
    },
    latitude: 47.6,
    longitude: -122.34,
    link: null,
  },
  mates: [
    { id: "3", name: "Bainbridge Island", abbreviation: "BBG" },
    { id: "4", name: "Bremerton", abbreviation: "BRE" },
  ],
  name: "Seattle",
  terminalUrl: "https://example.com/terminal",
  waitTimes: [
    {
      description: "Arrive 30–60 minutes before sailing.",
      title: "Vehicle arrival",
      time: 0,
    },
  ],
};

// inspect the anonymous content without browser-only source conversion
const render = (
  overrides: Partial<Terminal> = {},
  props: Omit<React.ComponentProps<typeof TerminalOverview>, "terminal"> = {}
): HTMLElement => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <TerminalOverview terminal={{ ...terminal, ...overrides }} {...props} />
    </MemoryRouter>
  );
  return page;
};

describe("search-focused terminal overview", () => {
  // keep terminal identity and navigation outside source-owned loading regions
  it("loads only unresolved terminal facts without false unavailable states", () => {
    const page = render(
      {
        hasElevator: undefined,
        hasFood: undefined,
        hasOverheadLoading: undefined,
        hasRestroom: undefined,
        hasWaitingRoom: undefined,
        info: undefined,
        location: undefined,
        waitTimes: undefined,
      },
      { loading: true }
    );
    const busyRegions = Array.from(
      page.querySelectorAll<HTMLElement>('[role="status"][aria-busy="true"]')
    );

    expect(page.querySelector("h1")?.textContent).toBe(
      "Seattle Ferry Terminal"
    );
    expect(page.querySelector("h1")?.className).toBe(
      "text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white"
    );
    expect(page.querySelector("h1")?.previousElementSibling).toBeNull();
    expect(page.textContent).not.toContain("Washington State Ferries · SEA");
    expect(page.textContent).toContain(
      "Find parking, directions, arrival guidance and terminal facilities."
    );
    expect(
      page.querySelector('nav[aria-label="Terminal planning links"]')
    ).not.toBeNull();
    expect(
      page.querySelector('nav[aria-label="Terminal information"]')
    ).not.toBeNull();
    expect(
      busyRegions.map((region) => region.getAttribute("aria-label"))
    ).toEqual([
      "Loading terminal address",
      "Loading parking and transit details",
      "Loading WSF arrival guidance",
      "Loading accessibility details",
      "Loading terminal facilities",
    ]);
    expect(page.querySelectorAll(".skeleton")).toHaveLength(13);
    // section headings and links remain static answers rather than placeholders
    page
      .querySelectorAll("h1, h2, nav a")
      .forEach((element) =>
        expect(element.closest('[role="status"]')).toBeNull()
      );
    expect(page.textContent).not.toContain("Address unavailable");
    expect(page.textContent).not.toContain("Parking details are not available");
    expect(page.textContent).not.toContain("Arrival guidance is not available");
    expect(page.textContent).not.toContain(
      "Accessibility details are not available"
    );
    expect(page.textContent).not.toMatch(/: unavailable/);
  });

  // answer practical terminal questions before secondary content
  it("exposes address, parking, arrival advice, accessibility and all source details", () => {
    const page = render();
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe(
      "Seattle Ferry Terminal"
    );
    expect(page.querySelector("address")?.textContent).toContain(
      "Seattle, WA 98104"
    );
    expect(page.querySelector("address")?.textContent).toContain(
      "801 Alaskan Way"
    );
    // retain every provider detail in the initial html
    Object.values(terminal.info).forEach((text) =>
      expect(page.textContent).toContain(text)
    );
    expect(page.querySelector("#terminal-parking details")).toBeNull();
    expect(page.querySelector("#terminal-accessibility details")).toBeNull();
    expect(page.querySelector("#terminal-arrival")?.textContent).toContain(
      "not a measured live queue wait"
    );
    expect(page.textContent).toContain("Source update time unavailable");
    expect(page.textContent).not.toContain("1970");
    expect(page.querySelector("#terminal-facilities")?.textContent).toContain(
      "Elevator: available"
    );
    expect(page.querySelector("#terminal-facilities")?.textContent).toContain(
      "Waiting room: unavailable"
    );
    expect(page.textContent).not.toContain("Vending machines");
    // every jump link must name a real section
    page
      .querySelectorAll<HTMLAnchorElement>(
        'nav[aria-label="Terminal information"] a'
      )
      .forEach((link) => {
        expect(
          page.querySelector(link.getAttribute("href") ?? "")
        ).not.toBeNull();
      });
  });

  // retain semantic answers without top-level card shells
  it("removes card wrappers and the ferry-connections section", () => {
    const page = render();
    const sections = [
      page.querySelector("h1")?.closest("section"),
      ...page.querySelectorAll(
        '#terminal-parking, #terminal-arrival, #terminal-accessibility, #terminal-facilities, [aria-label="More terminal information"]'
      ),
    ];
    // only nested guidance and facility treatments remain styled as cards
    sections.forEach((section) => {
      expect(section).not.toBeNull();
      expect(section?.className).not.toMatch(
        /rounded|\bborder\b|bg-|\bp[xy]?-\d/
      );
    });
    expect(page.querySelector("#terminal-routes")).toBeNull();
    expect(page.textContent).not.toContain("Ferries from");
  });

  // route buttons match the schedule page with its terminal button replaced
  it("uses six natural-width icon buttons for the selected direction", () => {
    const links = [
      ...render().querySelectorAll(
        'nav[aria-label="Terminal planning links"] a'
      ),
    ];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Schedule & wait",
      "What boat will I make?",
      "Ferry line cameras",
      "Route Map",
      "How much does it cost?",
      "WSF Alerts",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/seattle/bainbridge",
      "/seattle/bainbridge/navigation",
      "/seattle/bainbridge/cameras",
      "/seattle/bainbridge/map",
      "/seattle/bainbridge/fare",
      "/seattle/bainbridge/alerts",
    ]);
    // decorative icons and single-line left alignment match the shared buttons
    links.forEach((link) => {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(link.classList).toContain("text-left");
      expect(link.classList).toContain("whitespace-nowrap");
      expect(link.classList).toContain("w-fit");
    });
    const selected = render({}, { mate: { id: "4", name: "Bremerton" } });
    expect(
      selected.querySelector('a[href="/seattle/bremerton"]')
    ).not.toBeNull();
    expect(selected.querySelector('a[href="/seattle/bainbridge"]')).toBeNull();
  });

  // keep icon-only map navigation beside the address with an accessible name
  it("puts the directions icon button beside the address and removes the WSF link", () => {
    const page = render();
    const directions = page.querySelector<HTMLAnchorElement>(
      'a[aria-label="Get directions"]'
    )!;
    const address = page.querySelector("address")!;
    expect(directions.textContent).toBe("");
    expect(directions.getAttribute("title")).toBe("Get directions");
    expect(directions.getAttribute("target")).toBe("_blank");
    expect(directions.getAttribute("rel")).toBe("noopener noreferrer");
    expect(directions.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(directions.classList).toContain("h-11");
    expect(directions.classList).toContain("w-11");
    expect(address.nextElementSibling).toBe(directions);
    expect(address.parentElement?.classList).toContain("flex");
    expect(
      page.querySelector('a[href="https://example.com/terminal"]')
    ).toBeNull();
    expect(page.textContent).not.toContain("WSF terminal page");
  });

  // local section jumps precede cross-page tools in loaded and pending content
  it.each([false, true])(
    "places in-page links above route buttons while loading=%s",
    (loading) => {
      const page = render({}, { loading });
      const sectionLinks = page.querySelector(
        'nav[aria-label="Terminal information"]'
      )!;
      const routeButtons = page.querySelector(
        'nav[aria-label="Terminal planning links"]'
      )!;

      expect(sectionLinks.nextElementSibling).toBe(routeButtons);
      expect(
        sectionLinks.previousElementSibling?.querySelector("h1")
      ).not.toBeNull();
    }
  );

  // reduce link-row gaps without changing the in-page anchors
  it("uses tighter in-page navigation spacing", () => {
    const page = render();
    const navigation = page.querySelector(
      'nav[aria-label="Terminal information"]'
    )!;
    expect(navigation.classList).toContain("gap-x-3");
    expect(navigation.classList).toContain("gap-y-0");
    expect(navigation.classList).not.toContain("px-1");
    // all four links remain reachable and retain a practical target height
    navigation.querySelectorAll("a").forEach((link) => {
      expect(link.classList).toContain("min-h-9");
      expect(page.querySelector(link.getAttribute("href")!)).not.toBeNull();
    });
  });

  // the ad follows navigation and precedes the terminal answers exactly once
  it("inserts the ad directly after navigation links", () => {
    const page = render(
      {},
      { afterNavigation: <div data-ad-slot="terminal" /> }
    );
    const ad = page.querySelector('[data-ad-slot="terminal"]')!;
    expect(page.querySelectorAll('[data-ad-slot="terminal"]')).toHaveLength(1);
    expect(ad.previousElementSibling?.getAttribute("aria-label")).toBe(
      "Terminal planning links"
    );
    expect(
      ad.nextElementSibling?.querySelector("#terminal-parking")
    ).not.toBeNull();
  });

  // one-mate terminals retain canonical planning links
  it("links a single destination without a redundant mate slug", () => {
    const page = render({
      id: "5",
      name: "Clinton",
      mates: [{ id: "14", name: "Mukilteo", abbreviation: "MUK" }],
    });
    expect(page.querySelector('a[href="/clinton"]')).not.toBeNull();
    expect(page.querySelector('a[href="/clinton/fare"]')).not.toBeNull();
    expect(page.querySelector('a[href="/clinton/mukilteo"]')).toBeNull();
  });

  // missing source data must remain explicit rather than invented
  it("keeps missing parking, accessibility, arrival and address information unknown", () => {
    const page = render({
      info: {},
      waitTimes: [],
      mates: [],
      location: { ...terminal.location, address: null },
    });
    expect(page.textContent).toContain("Address unavailable");
    expect(page.textContent).toContain("Parking details are not available");
    expect(page.textContent).toContain(
      "Accessibility details are not available"
    );
    expect(page.textContent).toContain("Arrival guidance is not available");
    expect(
      page.querySelector('nav[aria-label="Terminal planning links"]')
    ).toBeNull();
    expect(
      page.querySelector(
        'a[href="https://www.google.com/maps/search/47.6,-122.34"]'
      )
    ).not.toBeNull();
    expect(page.textContent).not.toMatch(
      /free parking|zero.minute wait|fully accessible/i
    );
  });

  // retain source age and handle malformed epochs honestly
  it("shows dated source guidance without claiming a current wait", () => {
    const page = render({
      waitTimes: [
        { description: "Historic arrival advice", time: 1688212800 },
        { description: "Undated advice", time: Number.NaN },
      ],
    });
    expect(
      page.querySelector("#terminal-arrival time")?.getAttribute("datetime")
    ).toContain("2023-07-01");
    expect(page.querySelector("#terminal-arrival")?.textContent).toContain(
      "2023"
    );
    expect(page.querySelector("#terminal-arrival")?.textContent).toContain(
      "Source update time unavailable"
    );
  });

  // unknown terminal ids must not produce broken navigation
  it("omits route tool links when no canonical identity is known", () => {
    const page = render({ id: "unknown" });
    expect(
      page.querySelector('nav[aria-label="Terminal planning links"]')
    ).toBeNull();
    expect(page.innerHTML).not.toContain("/undefined");
  });

  // malformed provider html and non-web map schemes use dock coordinates
  it.each([
    "https://maps.example/terminal</p>",
    "https://maps.example/%3C/p%3E",
    // eslint-disable-next-line no-script-url -- reject executable source urls
    "javascript:alert(1)",
    "not a URL",
  ])("falls back from an invalid map link: %s", (link) => {
    const page = render({ location: { ...terminal.location, link } });
    expect(
      page
        .querySelector(
          'a[href="https://www.google.com/maps/search/47.6,-122.34"]'
        )
        ?.getAttribute("aria-label")
    ).toBe("Get directions");
  });

  // preserve intentional valid map overrides
  it("uses a valid provider map destination", () => {
    const page = render({
      location: { ...terminal.location, link: "https://maps.example/dock" },
    });
    expect(
      page
        .querySelector('a[href="https://maps.example/dock"]')
        ?.getAttribute("rel")
    ).toBe("noopener noreferrer");
  });

  // whitespace-only source fields behave like missing details
  it("does not render empty secondary disclosures", () => {
    const page = render({ info: { parking: " ", ada: "", lost: "\n" } });
    expect(page.querySelector("details")).toBeNull();
    expect(page.textContent).toContain("Parking details are not available");
  });
});
