// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeoHelmet } from "../../client/components/SeoHelmet";
import { removeSeedSeoTags } from "../../client/lib/seo";
import { getSeoMetadata, getSeoSchema } from "../../shared/lib/seo";

describe("client SEO", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("removes only server-seeded SEO elements", () => {
    document.head.innerHTML = `
      <title data-seo-seed="true">Server title</title>
      <meta data-seo-seed="true" name="description" content="Server description" />
      <meta name="theme-color" content="#016f52" />
    `;

    removeSeedSeoTags();

    expect(document.head.querySelectorAll("[data-seo-seed]")).toHaveLength(0);
    expect(
      document.head.querySelector('meta[name="theme-color"]')
    ).not.toBeNull();
  });

  it("hydrates absolute structured data for the canonical page", () => {
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    vi.stubGlobal("location", {
      host: "ferry.fyi",
      pathname: "/about",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        React.createElement(
          HelmetProvider,
          null,
          React.createElement(SeoHelmet, { seo: getSeoMetadata("/about") })
        )
      );
    });

    const schema = document.querySelector(
      'script[type="application/ld+json"]'
    )?.textContent;
    expect(schema).not.toContain('"@type":"BreadcrumbList"');
    expect(schema).toContain('"@type":"Organization"');
  });

  it("keeps Dataset claims factual without asserting a mixed-source license", () => {
    const seo = getSeoMetadata("/data-sources");
    const graph = getSeoSchema(seo, "https://ferry.fyi")["@graph"] as Array<
      Record<string, unknown>
    >;
    const dataset = graph.find((entry) => entry["@type"] === "Dataset");

    expect(dataset).toMatchObject({
      isAccessibleForFree: true,
      spatialCoverage: { name: "Washington State, United States" },
    });
    expect(dataset?.provider).toBeDefined();
    expect(dataset?.measurementTechnique).toContain("timestamps");
    expect(dataset).not.toHaveProperty("license");
  });

  it("keeps hydrated metadata host-aware on howmanyboats.today", () => {
    vi.stubGlobal("location", {
      host: "howmanyboats.today",
      pathname: "/clinton",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        React.createElement(
          HelmetProvider,
          null,
          React.createElement(SeoHelmet, { seo: getSeoMetadata("/") })
        )
      );
    });

    expect(document.title).toBe("How Many Boats? - Ferry FYI");
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute("content")
    ).toBe("index,follow");
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href")
    ).toBe("https://howmanyboats.today");
    expect(
      document.querySelector('meta[property="og:url"]')?.getAttribute("content")
    ).toBe("https://howmanyboats.today");
  });
});
