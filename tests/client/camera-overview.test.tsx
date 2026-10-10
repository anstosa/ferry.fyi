// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CameraOverview } from "../../client/components/CameraOverview";

type Terminal = React.ComponentProps<typeof CameraOverview>["terminal"];
const terminal: Terminal = {
  cameras: [
    {
      carCapacity: 20,
      carsToBoat: null,
      id: "holding",
      image: {
        height: 245,
        url: "https://example.test/camera.jpg",
        width: 400,
      },
      isActive: true,
      location: { latitude: 47.6, longitude: -122.34 },
      orderFromTerminal: 0,
      owner: null,
      terminalId: "7",
      title: "Seattle Holding Lanes",
    },
  ],
  id: "7",
  mates: [{ id: "3" }, { id: "4" }],
  name: "Seattle",
};

// inspect shared initial-html content and current canonical planning links
const render = (overrides: Partial<Terminal> = {}): HTMLElement => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    <MemoryRouter
      initialEntries={["/seattle/bainbridge/cameras?date=2026-10-10"]}
    >
      <CameraOverview
        mate={{ id: "3", name: "Bainbridge Island" }}
        terminal={{ ...terminal, ...overrides }}
      />
    </MemoryRouter>
  );
  return page;
};

describe("departure-terminal camera overview", () => {
  // camera scope must not imply coverage of the destination terminal
  it("names the departure terminal without a camera disclaimer paragraph", () => {
    const page = render();
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe(
      "Seattle ferry terminal cameras"
    );
    expect(page.textContent).toContain(
      "at the Seattle ferry terminal before departing for Bainbridge Island"
    );
    expect(page.textContent).not.toContain(
      "not live video or measured wait times"
    );
    expect(page.textContent).not.toContain(
      "Image-check times and stale warnings"
    );
  });

  // dated camera visits still link to current planning tools
  it("uses six natural-width icon buttons for current route planning", () => {
    const links = [...render().querySelectorAll("nav a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Schedule & wait",
      "What boat will I make?",
      "Terminal info",
      "Route Map",
      "How much does it cost?",
      "WSF Alerts",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/seattle/bainbridge",
      "/seattle/bainbridge/navigation",
      "/seattle/terminal",
      "/seattle/bainbridge/map",
      "/seattle/bainbridge/fare",
      "/seattle/bainbridge/alerts",
    ]);
    // decorative icons accompany descriptive text
    links.forEach((link) => {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(link.classList).toContain("text-left");
      expect(link.classList).toContain("whitespace-nowrap");
      expect(link.classList).toContain("w-fit");
    });
  });

  // empty inventories keep trip planning available without promising images
  it("describes missing views honestly", () => {
    const page = render({ cameras: [] });
    expect(page.textContent).toContain(
      "No camera views are listed for the Seattle ferry terminal"
    );
    expect(page.textContent).not.toContain("View traffic camera images");
    expect(page.querySelectorAll("nav a")).toHaveLength(6);
  });

  // single-destination canonicals omit a redundant mate slug
  it("uses one-mate canonicals and never links unknown terminal identities", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <CameraOverview
          mate={{ id: "14", name: "Mukilteo" }}
          terminal={{
            ...terminal,
            id: "5",
            mates: undefined,
            name: "Clinton",
          }}
        />
      </MemoryRouter>
    );
    expect(page.querySelector('a[href="/clinton"]')).not.toBeNull();
    expect(page.querySelector('a[href="/clinton/alerts"]')).not.toBeNull();
    const unknown = render({ id: "unknown", mates: undefined });
    expect(unknown.querySelector("nav")).toBeNull();
    expect(unknown.innerHTML).not.toContain("/undefined");
  });
});
