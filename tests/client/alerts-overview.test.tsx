// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AlertsLoadingContent } from "../../client/components/AlertsLoadingContent";
import { AlertsOverview } from "../../client/components/AlertsOverview";

const terminal = {
  id: "7",
  mates: [{ id: "3" }, { id: "4" }],
  name: "Seattle",
};
const mate = { id: "3", name: "Bainbridge Island" };

// inspect the shared initial-html alert guidance and planning links
const renderOverview = (): HTMLElement => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <AlertsOverview mate={mate} terminal={terminal} />
    </MemoryRouter>
  );
  return page;
};

describe("route alerts overview", () => {
  // use route-specific search copy without the former colored hero
  it("leads with directional WSF alert guidance", () => {
    const page = renderOverview();
    const overview = page.querySelector("section");

    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe(
      "Seattle to Bainbridge Island WSF alerts"
    );
    expect(page.textContent).toContain(
      "service changes, delays and cancellations before you travel"
    );
    expect(overview?.className).not.toMatch(/rounded|shadow|gradient/);
    expect(page.textContent).not.toContain("Route alerts");
  });

  // replace the current page button with a useful schedule destination
  it("shows six natural-width icon planning buttons", () => {
    const links = [...renderOverview().querySelectorAll("nav a")];

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Schedule & wait",
      "What boat will I make?",
      "Ferry line cameras",
      "Terminal info",
      "Route Map",
      "How much does it cost?",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/seattle/bainbridge",
      "/seattle/bainbridge/navigation",
      "/seattle/bainbridge/cameras",
      "/seattle/terminal",
      "/seattle/bainbridge/map",
      "/seattle/bainbridge/fare",
    ]);
    links.forEach((link) => {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(link.classList).toContain("w-fit");
      expect(link.classList).toContain("whitespace-nowrap");
      expect(link.classList).toContain("text-left");
    });
  });

  // scope loading shapes to provider results, not known headings or links
  it("keeps route copy and actions outside the alert loading region", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <AlertsLoadingContent mate={mate} terminal={terminal} />
      </MemoryRouter>
    );
    const busy = page.querySelector('[role="status"][aria-busy="true"]');

    expect(page.querySelector("h1")?.textContent).toBe(
      "Seattle to Bainbridge Island WSF alerts"
    );
    expect(page.querySelector("h2")?.textContent).toBe("Service alerts");
    expect(page.querySelectorAll("nav a")).toHaveLength(6);
    expect(busy?.getAttribute("aria-label")).toBe("Loading route alerts");
    expect(busy?.querySelectorAll(".skeleton")).toHaveLength(8);
    expect(page.querySelector("h1")?.closest('[role="status"]')).toBeNull();
    expect(page.querySelector("nav")?.closest('[role="status"]')).toBeNull();
    expect(page.querySelectorAll("[data-loading-alert]")).toHaveLength(2);
  });

  // single-destination routes keep their canonical short route path
  it("uses the departure terminal when no mate is selected", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <AlertsOverview
          terminal={{ id: "5", mates: [{ id: "14" }], name: "Clinton" }}
        />
      </MemoryRouter>
    );

    expect(page.querySelector("h1")?.textContent).toBe(
      "Clinton ferry terminal alerts"
    );
    expect(page.querySelector('a[href="/clinton"]')?.textContent).toContain(
      "Schedule & wait"
    );
  });
});
