import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppRenderContextValue } from "../../client/lib/renderContext";

interface StaticPageOracle {
  path: string;
  title: string;
  visibleFacts: string[];
}

const STATIC_PAGE_ORACLES: StaticPageOracle[] = [
  {
    path: "/about",
    title: "Ferry FYI",
    visibleFacts: [
      "A ferry schedule and tracker",
      "Weather data and forecasts",
    ],
  },
  {
    path: "/data-sources",
    title: "Data sources and API guide",
    visibleFacts: ["Citing Ferry FYI data", "GET /api/fares/catalog"],
  },
  {
    path: "/forecasting",
    title: "Forecasting",
    visibleFacts: ["Recent direction-specific demand", "Booth lines"],
  },
  {
    path: "/install",
    title: "Install",
    visibleFacts: ["App Store", "Google Play", "web app"],
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    visibleFacts: [
      "Information we collect",
      "Advertising and sponsorship policy",
    ],
  },
  {
    path: "/support",
    title: "Support",
    visibleFacts: ["Supporter billing help", "Email Support"],
  },
  {
    path: "/supporter",
    title: "Support an independent ferry app",
    visibleFacts: ["Optional Supporter badge", "renew automatically"],
  },
  {
    path: "/terms",
    title: "Terms of Service",
    visibleFacts: ["Acceptable use", "Availability and liability"],
  },
  {
    path: "/tickets",
    title: "Tickets",
    visibleFacts: ["Ferry tickets, ready to scan", "Buy Tickets"],
  },
];

// render one public route through the production universal tree
const renderStaticPage = async (path: string): Promise<string> => {
  const { AppRoot } = await import("../../client/AppRoot");
  const requestUrl = `https://ferry.fyi${path}`;
  const context: AppRenderContextValue = {
    clock: () => 1_700_000_000_000,
    hasInjectedRequest: false,
    platform: "web",
    requestUrl,
    runtime: "server",
    seoBaseUrl: "https://ferry.fyi",
    seoHost: "ferry.fyi",
    seoPathname: path,
  };

  return renderToStaticMarkup(React.createElement(AppRoot, { context }));
};

describe("static public route content", () => {
  // require complete static content and one title heading in source HTML
  it.each(STATIC_PAGE_ORACLES)(
    "renders full meaningful HTML for $path",
    async ({ path, title, visibleFacts }) => {
      const html = await renderStaticPage(path);
      const headings = [...html.matchAll(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/g)];

      expect(headings[0]?.[1]).toBe("1");
      expect(headings.filter((heading) => heading[1] === "1")).toHaveLength(1);
      expect(headings[0]?.[2]).toContain(title);
      // public fact oracle
      for (const fact of visibleFacts) {
        expect(html).toContain(fact);
      }
    },
    15_000
  );

  // keep browser and native integrations out of the universal module graph
  it("renders mixed pages without loading browser-only SDKs", async () => {
    vi.resetModules();
    vi.doMock("@capacitor/barcode-scanner", () => {
      throw new Error("universal tree imported the barcode scanner");
    });
    vi.doMock("@capacitor-community/keep-awake", () => {
      throw new Error("universal tree imported keep-awake");
    });
    vi.doMock("@capacitor-community/screen-brightness", () => {
      throw new Error("universal tree imported screen brightness");
    });

    await expect(renderStaticPage("/install")).resolves.toContain("Install");
    await expect(renderStaticPage("/supporter")).resolves.toContain(
      "Support an independent ferry app"
    );
    await expect(renderStaticPage("/tickets")).resolves.toContain("Tickets");
  });
});
