// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutePlanningLinks } from "../../client/components/RoutePlanningLinks";
import { AppRenderProvider } from "../../client/lib/renderContext";

type Props = React.ComponentProps<typeof RoutePlanningLinks>;

// inspect real canonical tools without any data or trip-provider requests
const render = (
  props: Partial<Props> = {},
  now = Date.now()
): HTMLDivElement => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    <AppRenderProvider
      value={{
        clock: () => now,
        hasInjectedRequest: true,
        platform: "web",
        requestUrl: "https://ferry.fyi/seattle/bainbridge/navigation",
        runtime: "server",
        seoBaseUrl: "https://ferry.fyi",
        seoHost: "ferry.fyi",
        seoPathname: "/seattle/bainbridge/navigation",
      }}
    >
      <MemoryRouter
        initialEntries={[
          "/seattle/bainbridge/navigation?mode=walk&buffer=9#address=private",
        ]}
      >
        <RoutePlanningLinks
          currentView="navigation"
          terminal={{ id: "7" }}
          mate={{ id: "3" }}
          {...props}
        />
      </MemoryRouter>
    </AppRenderProvider>
  );
  return page;
};

describe("shared route planning buttons", () => {
  // release the browser clock override after each boundary case
  afterEach(() => vi.restoreAllMocks());

  // request clocks remain authoritative when browser time crosses the service boundary
  it.each([
    ["2026-10-09T09:59:00Z", "2026-10-08"],
    ["2026-10-09T10:00:00Z", "2026-10-09"],
  ])("uses the injected service day at %s", (instant, selectedDate) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-31T20:00:00Z"));
    const page = render({ selectedDate }, Date.parse(instant));
    expect(page.querySelector('a[href="/seattle/bainbridge"]')).not.toBeNull();
    expect(
      page.querySelector('a[href="/seattle/bainbridge/fare"]')
    ).not.toBeNull();
    expect(page.querySelector('a[href*="date="]')).toBeNull();
  });

  // every page keeps six compact icon links and omits its own destination
  it.each(["navigation", "fare", "alerts"] as const)(
    "renders the %s button set",
    (currentView) => {
      const page = render({ currentView });
      const tools = [...page.querySelectorAll('nav a:not([href^="#"])')];
      expect(tools).toHaveLength(6);
      // keep the bottom-bar order after omitting the current page
      const currentLabel = {
        navigation: "What boat will I make?",
        fare: "How much does it cost?",
        alerts: "WSF Alerts",
      }[currentView];
      expect(tools.map((link) => link.textContent)).toEqual(
        [
          "Schedule & wait",
          "What boat will I make?",
          "Ferry line cameras",
          "Terminal info",
          "Route Map",
          "How much does it cost?",
          "WSF Alerts",
        ].filter((label) => label !== currentLabel)
      );
      expect(
        tools.filter((link) => link.textContent === "Schedule & wait")
      ).toHaveLength(1);
      expect(
        tools.some((link) =>
          link.getAttribute("href")?.endsWith(`/${currentView}`)
        )
      ).toBe(false);
      // decorative icons and stable geometry match the schedule page
      tools.forEach((link) => {
        expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
        expect(link.classList).toContain("text-left");
        expect(link.classList).toContain("whitespace-nowrap");
        expect(link.classList).toContain("w-fit");
        expect(link.getAttribute("href")).not.toMatch(
          /private|mode=|buffer=|address=/
        );
      });
      expect(
        page.querySelector('a[href="/seattle/bainbridge"]')
      ).not.toBeNull();
      expect(page.querySelector('a[href="/seattle/terminal"]')).not.toBeNull();
    }
  );

  // retain the solid native calculator action in the bottom bar's fares position
  it("renders one solid custom fare button between map and alerts", () => {
    const page = render({ currentView: "fare" });
    const links = [...page.querySelectorAll("nav a")];
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.textContent)).toEqual([
      "Schedule & wait",
      "What boat will I make?",
      "Ferry line cameras",
      "Terminal info",
      "Route Map",
      "Calculate a custom fare",
      "WSF Alerts",
    ]);
    expect(links[5]?.getAttribute("href")).toBe("#custom-fare-calculator");
    expect(links[5]?.classList).toContain("bg-green-dark");
    expect(links[5]?.classList).toContain("text-white");
    expect(links[0]?.classList).not.toContain("bg-green-dark");
    expect(
      render({ currentView: "fare", includeCustomFare: false }).querySelector(
        'a[href^="#"]'
      )
    ).toBeNull();
  });

  // single-destination paths use their canonical shorthand even during static loading
  it("uses stable one-mate routes before terminal topology loads", () => {
    const page = render({ terminal: { id: "5" }, mate: { id: "14" } });
    expect(page.querySelector('a[href="/clinton"]')).not.toBeNull();
    expect(page.querySelector('a[href="/clinton/cameras"]')).not.toBeNull();
    expect(page.querySelector('a[href="/clinton/fare"]')).not.toBeNull();
    expect(page.innerHTML).not.toContain("/clinton/mukilteo");
    const catalogDefault = render({ terminal: { id: "5" }, mate: undefined });
    expect(catalogDefault.querySelector('a[href="/clinton"]')).not.toBeNull();
    expect(catalogDefault.innerHTML).not.toContain("/clinton/mukilteo");
  });

  // only date-capable destinations retain a selected historical service day
  it("preserves service dates without forwarding private parameters to live-only tools", () => {
    const page = render({ currentView: "alerts", selectedDate: "2000-01-01" });
    expect(
      page.querySelector('a[href="/seattle/bainbridge?date=2000-01-01"]')
    ).not.toBeNull();
    expect(
      page.querySelector('a[href="/seattle/bainbridge/fare?date=2000-01-01"]')
    ).not.toBeNull();
    expect(
      page.querySelector('a[href="/seattle/bainbridge/navigation"]')
    ).not.toBeNull();
    expect(
      page.querySelector('a[href="/seattle/bainbridge/cameras"]')
    ).not.toBeNull();
    expect(
      page.querySelector('a[href="/seattle/bainbridge/map"]')
    ).not.toBeNull();
  });

  // malformed or unknown terminal pairs never create broken planning paths
  it("omits route links when a canonical direction cannot be established", () => {
    expect(
      render({ terminal: { id: "unknown" } }).querySelector("nav")
    ).toBeNull();
    expect(render({ mate: { id: "14" } }).querySelector("nav")).toBeNull();
    const page = render({
      currentView: "fare",
      terminal: undefined,
      mate: undefined,
    });
    expect(page.querySelectorAll("nav a")).toHaveLength(1);
    expect(page.innerHTML).not.toContain("/undefined");
  });
});
