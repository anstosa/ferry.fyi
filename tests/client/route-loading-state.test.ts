// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppLoadingState } from "../../client/components/AppLoadingState";
import { RouteLoadingState } from "../../client/components/RouteLoadingState";
import { AppRenderProvider } from "../../client/lib/renderContext";
import { getRouteLoadingContext } from "../../client/lib/routeLoadingContext";
import type { RouteView } from "../../client/lib/routeViews";
import { getRecommendationServiceDate } from "../../shared/lib/sailingRecommendationRevision";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const views: RouteView[] = [
  "schedule",
  "navigation",
  "cameras",
  "terminal",
  "fare",
  "map",
  "alerts",
  "subscribe",
];

describe("RouteLoadingState", () => {
  // pending routes use the request clock even when the browser crosses the service boundary
  it.each([
    ["2026-10-09T09:59:00Z", "2026-10-08"],
    ["2026-10-09T10:00:00Z", "2026-10-09"],
  ])(
    "keeps static loading content on the injected day at %s",
    (instant, selectedDate) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-31T20:00:00Z"));
      // verify the ordinary pending page and both current-only planning surfaces
      for (const view of ["schedule", "cameras", "navigation"] as const) {
        const path = `/seattle/bainbridge${view === "schedule" ? "" : `/${view}`}`;
        const page = document.createElement("div");
        page.innerHTML = renderToStaticMarkup(
          React.createElement(AppRenderProvider, {
            value: {
              clock: () => Date.parse(instant),
              hasInjectedRequest: true,
              platform: "web",
              requestUrl: `https://ferry.fyi${path}`,
              runtime: "server",
              seoBaseUrl: "https://ferry.fyi",
              seoHost: "ferry.fyi",
              seoPathname: path,
            },
            children: React.createElement(MemoryRouter, {
              initialEntries: [path],
              children: React.createElement(AppLoadingState, {
                pathname: path,
                search: `?date=${selectedDate}`,
              }),
            }),
          })
        );
        expect(page.textContent).not.toContain("Go to today");
        expect(page.querySelector('a[href*="date="]')).toBeNull();
        expect(page.querySelector("h1")).not.toBeNull();
        // recent confirmed sailing placeholders belong only to the selected current day
        if (view === "schedule") {
          expect(
            page.querySelectorAll("[data-loading-past-sailing]")
          ).toHaveLength(4);
          expect(page.textContent).not.toContain("Wait time not forecast");
        }
      }
    }
  );

  // known page content must not disappear behind source-owned loading shapes
  it.each([
    ["schedule", "Seattle to Bainbridge ferry wait times & schedule"],
    ["fare", "Seattle to Bainbridge ferry fares"],
    ["cameras", "Seattle ferry terminal cameras"],
    ["terminal", "Seattle Ferry Terminal"],
    ["navigation", "What boat will I make?"],
    ["alerts", "Seattle to Bainbridge WSF alerts"],
  ] as const)(
    "shows the static %s page while data is pending",
    (view, title) => {
      const path =
        view === "terminal"
          ? "/seattle/terminal"
          : `/seattle/bainbridge${view === "schedule" ? "" : `/${view}`}`;
      const context = getRouteLoadingContext(
        path,
        `?date=${getRecommendationServiceDate(Date.now() / 1000)}`
      );
      const page = document.createElement("div");
      page.innerHTML = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path] },
          React.createElement(RouteLoadingState, {
            context: context ?? undefined,
            view,
          })
        )
      );
      const heading = [...page.querySelectorAll("h1, h2")].find(
        (element) => element.textContent === title
      );
      expect(heading).toBeDefined();
      // page titles share compact typography without an eyebrow above them
      expect(heading?.tagName).toBe("H1");
      expect(heading?.className).toBe(
        "text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white"
      );
      expect(heading?.previousElementSibling).toBeNull();
      expect(heading?.closest('[role="status"]')).toBeNull();
      // tall pending content must not shrink the header and pull titles upward
      expect(page.querySelector("header")?.classList).toContain("shrink-0");
      // static buttons retain bottom-bar order before source data or bundles arrive
      const currentLabel = {
        schedule: "Schedule & wait",
        navigation: "What boat will I make?",
        cameras: "Ferry line cameras",
        terminal: "Terminal info",
        fare: "How much does it cost?",
        alerts: "WSF Alerts",
      }[view];
      const planning = page.querySelector(
        'nav[aria-label$="planning links"], nav[aria-label="Route quick links"]'
      );
      expect(
        [...(planning?.querySelectorAll("a") ?? [])].map(
          (link) => link.textContent
        )
      ).toEqual(
        [
          "Schedule & wait",
          "What boat will I make?",
          "Ferry line cameras",
          "Terminal info",
          "Route Map",
          "How much does it cost?",
          "WSF Alerts",
        ]
          .filter((label) => view === "fare" || label !== currentLabel)
          .map((label) =>
            view === "fare" && label === currentLabel
              ? "Calculate a custom fare"
              : label
          )
      );
      expect(page.querySelector("header .skeleton")).toBeNull();
      // the reshaped loading regions contain only unknown values or images
      if (view === "fare") {
        expect(page.querySelectorAll(".skeleton")).toHaveLength(4);
        expect(page.textContent).toContain("One adult walk-on");
        expect(page.textContent).toContain("Standard vehicle & driver");
        expect(
          page.querySelectorAll('[aria-label="Fare estimator"] button')
        ).toHaveLength(3);
      }
      // waiting for source data is not proof of an empty terminal or timetable
      if (view === "schedule") {
        expect(page.textContent).toContain("Vehicle wait");
        expect(page.textContent).toContain("Next scheduled");
        expect(page.textContent).not.toMatch(
          /None reported|Departure data unavailable/
        );
        expect(
          page.querySelectorAll("[data-loading-past-sailing]")
        ).toHaveLength(4);
      }
      // preserve the static terminal answer sections and compact navigation
      if (view === "terminal") {
        expect(
          page.querySelectorAll('nav[aria-label="Terminal information"] a')
        ).toHaveLength(4);
        expect(page.textContent).toContain("Parking & getting here");
        expect(page.textContent).toContain("Restrooms");
        expect(page.textContent).not.toContain("unavailable");
      }
      // navigation controls remain placeholders until sailings are available
      if (view === "navigation") {
        expect(page.textContent).toContain("Travel method");
        expect(page.textContent).toContain("Safety buffer");
        expect(
          page.querySelector('input[aria-label="Starting address"]')
        ).toBeNull();
        expect(
          page.querySelectorAll("[data-navigation-form-loading] .skeleton")
        ).toHaveLength(8);
      }
      // inventory loading must not claim that no camera views exist
      if (view === "cameras") {
        expect(page.textContent).not.toContain("No camera views are listed");
        expect(page.querySelectorAll(".skeleton")).toHaveLength(2);
      }
      // alert guidance and tools remain outside source-owned pending rows
      if (view === "alerts") {
        expect(
          page.querySelectorAll('nav[aria-label="Alert planning links"] a')
        ).toHaveLength(6);
        expect(page.querySelectorAll("[data-loading-alert]")).toHaveLength(2);
        expect(page.querySelectorAll(".skeleton")).toHaveLength(8);
        expect(page.textContent).not.toMatch(/All clear|No active alerts/);
      }
    }
  );
  // the outer lazy-route boundary must preserve static page content too
  it.each([
    "/seattle/bainbridge",
    "/seattle/bainbridge/fare",
    "/seattle/bainbridge/cameras",
    "/seattle/terminal",
    "/seattle/bainbridge/navigation",
    "/seattle/bainbridge/alerts",
  ])("renders route-specific content before the route bundle at %s", (path) => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(AppLoadingState, { pathname: path })
      )
    );
    expect(page.querySelector("[data-route-loading]")).not.toBeNull();
    expect(page.querySelector("h1, h2")).not.toBeNull();
    expect(page.querySelector("header .skeleton")).toBeNull();
  });

  // historical or future dates have no current-day compact history section
  it("keeps date-specific schedule placeholders free of current history", () => {
    const path = "/seattle/bainbridge";
    const context = getRouteLoadingContext(path, "?date=2001-01-01")!;
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(RouteLoadingState, { context, view: "schedule" })
      )
    );
    expect(page.querySelector("[data-loading-past-sailing]")).toBeNull();
    expect(page.textContent).toContain("Wait time not forecast");
  });

  // past live-only tabs render their fixed recovery action without pretending to load data
  it.each(["cameras", "navigation", "map", "alerts"] as const)(
    "shows the date recovery for %s without loaders",
    (view) => {
      const path = `/seattle/bainbridge/${view}`;
      const context = getRouteLoadingContext(path, "?date=2001-01-01")!;
      const page = document.createElement("div");
      page.innerHTML = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: [`${path}?date=2001-01-01`] },
          React.createElement(RouteLoadingState, { context, view })
        )
      );
      expect(page.textContent).toContain("Go to today");
      expect(
        page.querySelector(".skeleton, input, [aria-busy=true]")
      ).toBeNull();
      expect(page.querySelector("a")?.getAttribute("href")).toBe(path);
    }
  );

  // known provider prose must match the live page rather than exposing raw tags
  it("converts terminal HTML in the resolved lazy fallback", () => {
    const path = "/seattle/terminal";
    const context = getRouteLoadingContext(path)!;
    context.terminal.info = {
      parking:
        '<p>Dock parking<br>Use <a href="https://example.com/parking">the garage</a></p><script>hidden()</script>',
    };
    context.terminal.waitTimes = [
      {
        time: 1,
        title: "Arrival",
        description: "<p>Arrive early<br>Check the queue</p>",
      },
    ];
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(RouteLoadingState, { context, view: "terminal" })
      )
    );
    expect(page.textContent).toContain(
      "Dock parking\nUse the garage (https://example.com/parking)"
    );
    expect(page.textContent).toContain("Arrive early\nCheck the queue");
    expect(page.textContent).not.toMatch(/<p>|<br>|<a|hidden\(\)/);
    expect(page.querySelector(".skeleton")).toBeNull();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it.each(views)("renders an accessible %s loading layout", (view) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          MemoryRouter,
          {},
          React.createElement(RouteLoadingState, { view })
        )
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-label")).toContain("Loading");
    // each unresolved page keeps an accessible loading region
    expect(
      container.querySelectorAll(".skeleton").length
    ).toBeGreaterThanOrEqual(1);

    act(() => root.unmount());
  });
});
