import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { HomeHero } from "../../client/components/HomeHero";

const homeHeroSource = readFileSync("client/components/HomeHero.tsx", "utf-8");
const indexHtml = readFileSync("client/index.html", "utf-8");
const mapSource = readFileSync("client/views/Map.tsx", "utf-8");

describe("initial-load resources", () => {
  it("prioritizes and sizes the visible Ferry FYI logo", () => {
    const document = new JSDOM(
      renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/"] },
          React.createElement(HomeHero, { leaderboardsEnabled: true })
        )
      )
    ).window.document;
    const logo = document.querySelector<HTMLImageElement>("img[fetchpriority]");

    expect(logo?.alt).toBe("");
    expect(logo?.getAttribute("fetchpriority")).toBe("high");
    expect(logo?.height).toBe(112);
    expect(logo?.src).toContain("icon_monochrome-256");
    expect(logo?.width).toBe(112);
  });

  it("keeps the home hero below the native top safe area", () => {
    expect(homeHeroSource).toContain(
      'h-[calc(16rem+var(--safe-area-inset-top))]'
    );
    expect(homeHeroSource).toContain("pt-safe-top");
  });

  it("defers route-only map and font styles", () => {
    expect(indexHtml).not.toContain("api.mapbox.com/mapbox-gl-js");
    expect(indexHtml).toContain('media="print"');
    expect(mapSource).toContain('import "mapbox-gl/dist/mapbox-gl.css";');
  });
});
