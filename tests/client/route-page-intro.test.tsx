// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RouteLoadingState } from "../../client/components/RouteLoadingState";
import { RoutePageIntro } from "../../client/components/RoutePageIntro";
import { getRouteLoadingContext } from "../../client/lib/routeLoadingContext";
import type { RouteView } from "../../client/lib/routeViews";
import { getRecommendationServiceDate } from "../../shared/lib/sailingRecommendationRevision";

interface RouteCase {
  path: string;
  title: string;
  view: Extract<
    RouteView,
    "alerts" | "cameras" | "fare" | "navigation" | "schedule" | "terminal"
  >;
}

const ROUTES: readonly RouteCase[] = [
  {
    path: "/seattle/bainbridge",
    title: "Seattle to Bainbridge ferry wait times & schedule",
    view: "schedule",
  },
  {
    path: "/seattle/bainbridge/navigation",
    title: "What boat will I make?",
    view: "navigation",
  },
  {
    path: "/seattle/bainbridge/cameras",
    title: "Seattle ferry terminal cameras",
    view: "cameras",
  },
  {
    path: "/seattle/terminal",
    title: "Seattle Ferry Terminal",
    view: "terminal",
  },
  {
    path: "/seattle/bainbridge/fare",
    title: "Seattle to Bainbridge ferry fares",
    view: "fare",
  },
  {
    path: "/seattle/bainbridge/alerts",
    title: "Seattle to Bainbridge WSF alerts",
    view: "alerts",
  },
];
const TITLE_CLASS =
  "text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white";

// render a current route so live-only fallbacks retain their normal page content
const renderLoadingPage = ({ path, view }: RouteCase): HTMLElement => {
  const selectedDate = getRecommendationServiceDate(Date.now() / 1000);
  const context = getRouteLoadingContext(path, `?date=${selectedDate}`);
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`${path}?date=${selectedDate}`] },
      React.createElement(RouteLoadingState, {
        context: context ?? undefined,
        view,
      })
    )
  );
  return page;
};

describe("RoutePageIntro", () => {
  // keep typography and description spacing in one padding-free primitive
  it("renders the canonical route title and description", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <RoutePageIntro
        description={<time dateTime="2026-10-09">October 9, 2026</time>}
        id="route-title"
        title={
          <>
            Seattle to <strong>Bainbridge</strong>
          </>
        }
      />
    );

    const intro = page.querySelector<HTMLElement>("[data-route-page-intro]");
    const heading = intro?.querySelector(":scope > h1");
    const description = intro?.querySelector(":scope > p");
    expect(intro).not.toBeNull();
    expect(intro?.className ?? "").not.toMatch(
      /(?:^|\s)(?:\S+:)*(?:m[trblxy]?|p[trblxy]?|gap|space-[xy])-/
    );
    expect(heading?.id).toBe("route-title");
    expect(heading?.className).toBe(TITLE_CLASS);
    expect(heading?.textContent).toBe("Seattle to Bainbridge");
    expect(heading?.previousElementSibling).toBeNull();
    expect(description?.className).toBe(
      "mt-2 text-sm leading-normal text-gray-600 dark:text-gray-300"
    );
    expect(description?.querySelector("time")?.dateTime).toBe("2026-10-09");
  });

  // do not invent an eyebrow or placeholder when supporting copy is absent
  it("renders only the title when no description is provided", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      <RoutePageIntro title="Ferry schedules & wait times" />
    );
    const intro = page.querySelector<HTMLElement>("[data-route-page-intro]");

    expect(intro?.children).toHaveLength(1);
    expect(intro?.firstElementChild?.tagName).toBe("H1");
    expect(intro?.querySelector("p")).toBeNull();
  });

  // static route answers stay visible and outside source-owned loading regions
  it.each(ROUTES)(
    "uses the shared intro for the pending $view page",
    (route) => {
      const page = renderLoadingPage(route);
      const intros = page.querySelectorAll<HTMLElement>(
        "[data-route-page-intro]"
      );
      const intro = intros[0];
      const heading = intro?.querySelector(":scope > h1");
      const description = intro?.querySelector(":scope > p");

      expect(intros).toHaveLength(1);
      expect(page.querySelectorAll("h1")).toHaveLength(1);
      expect(intro?.firstElementChild).toBe(heading);
      expect(heading?.textContent).toBe(route.title);
      expect(heading?.className).toBe(TITLE_CLASS);
      expect(heading?.previousElementSibling).toBeNull();
      expect(description?.className).toBe(
        "mt-2 text-sm leading-normal text-gray-600 dark:text-gray-300"
      );
      expect(intro?.closest('[role="status"], [aria-busy="true"]')).toBeNull();
      expect(intro?.querySelector(".skeleton")).toBeNull();
    }
  );

  // overview sections own one uniform inset without responsive padding drift
  it.each(["schedule", "cameras", "alerts"] as const)(
    "uses canonical overview padding for the pending %s page",
    (view) => {
      const route = ROUTES.find((candidate) => candidate.view === view)!;
      const page = renderLoadingPage(route);
      const intro = page.querySelector<HTMLElement>("[data-route-page-intro]");
      const overview = intro?.closest("section");

      expect(overview?.classList.contains("p-4")).toBe(true);
      expect(overview?.classList.contains("py-3")).toBe(false);
      expect(overview?.classList.contains("px-4")).toBe(false);
      expect(overview?.classList.contains("sm:px-6")).toBe(false);
    }
  );

  // constrain navigation controls without narrowing its page title geometry
  it("keeps the navigation intro full-width and constrains only the form", () => {
    const route = ROUTES.find((candidate) => candidate.view === "navigation")!;
    const page = renderLoadingPage(route);
    const intro = page.querySelector<HTMLElement>("[data-route-page-intro]");
    const pageSection = intro?.closest("section");
    const form = page.querySelector<HTMLElement>(
      "[data-navigation-form-loading]"
    );
    const formConstraint = form?.closest<HTMLElement>(".max-w-2xl");
    const planning = page.querySelector<HTMLElement>(
      'nav[aria-label="Navigation planning links"]'
    );

    expect(pageSection?.classList.contains("max-w-6xl")).toBe(true);
    expect(pageSection?.classList.contains("p-4")).toBe(true);
    expect(pageSection?.classList.contains("max-w-2xl")).toBe(false);
    expect(intro?.closest(".max-w-2xl")).toBeNull();
    expect(planning?.closest(".max-w-2xl")).toBeNull();
    expect(formConstraint).not.toBeNull();
    expect(formConstraint?.classList.contains("mx-auto")).toBe(true);
    expect(formConstraint?.contains(intro ?? null)).toBe(false);
  });

  // terminal and fare shells own the same page width and inset
  it.each(["terminal", "fare"] as const)(
    "uses the canonical outer geometry for the pending %s page",
    (view) => {
      const route = ROUTES.find((candidate) => candidate.view === view)!;
      const page = renderLoadingPage(route);
      const intro = page.querySelector<HTMLElement>("[data-route-page-intro]");
      const shell = intro?.closest<HTMLElement>(".max-w-6xl");

      expect(shell?.classList.contains("p-4")).toBe(true);
      expect(shell?.classList.contains("max-w-6xl")).toBe(true);
    }
  );
});
