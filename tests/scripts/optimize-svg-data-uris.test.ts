import { createRequire } from "node:module";

import postcss, { Plugin } from "postcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const optimizeSvgDataUris =
  require("../../scripts/optimize-svg-data-uris.cjs") as Plugin;

// retain equivalent SVG markup while reducing stylesheet bytes
describe("inline SVG data URI optimization", () => {
  // verify the percent-encoded Mapbox asset shape is compacted
  it("shortens UTF-8 SVG data URIs without dropping markup", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text>hash # and quotes \'" — Sailing ⛴</text></svg>';
    const input = `.icon{background-image:url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")}`;

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css.length).toBeLessThan(input.length);
    expect(result.css).not.toContain(";charset=utf-8");
    expect(result.css).toContain("%23");
    expect(result.css).toContain("%22");
    expect(result.css).toContain("%27");
    const payload = result.css.match(/data:image\/svg\+xml,([^"}]+)/)?.[1];
    expect(payload).toBeDefined();
    expect(decodeURIComponent(payload ?? "")).toBe(svg);
  });

  // avoid rewriting unrelated or already compact assets
  it("leaves other URLs unchanged", async () => {
    const input =
      ".icons{background:url('/icon.svg')}" +
      '.inline{background:url("data:image/svg+xml,%3csvg/%3e")}';

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css).toBe(input);
  });

  // preserve URL fragment selection outside the SVG payload
  it("leaves SVG fragment selectors unchanged", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><view id="icon"/></svg>';
    const input = `.icon{mask:url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}#icon")}`;

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css).toBe(input);
  });

  // fail closed when CSS escaping makes the payload ambiguous
  it("leaves escaped quotes unchanged", async () => {
    const input = String.raw`.icon{background:url("data:image/svg+xml;charset=utf-8,%3Csvg%20data-note=\"quoted\"%3E%3C%2Fsvg%3E")}`;

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css).toBe(input);
  });

  // fail closed on malformed percent encoding
  it("leaves non-percent-encoded payloads unchanged", async () => {
    const input =
      `.icon{background:url("data:image/svg+xml;charset=utf-8,` +
      `<svg width='100%'></svg>")}` +
      `.invalid{background:url("data:image/svg+xml;charset=utf-8,%FF")}`;

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css).toBe(input);
  });

  // avoid treating ordinary CSS strings as URL tokens
  it("leaves data URI-like content strings unchanged", async () => {
    const input =
      '.label{content:"data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E"}' +
      `.literal{content:'url("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E")'}`;

    const result = await postcss([optimizeSvgDataUris]).process(input, {
      from: undefined,
    });

    expect(result.css).toBe(input);
  });
});
