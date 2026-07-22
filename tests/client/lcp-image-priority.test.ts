import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync("client/views/Home.tsx", "utf-8");
const indexHtml = readFileSync("client/index.html", "utf-8");
const mapSource = readFileSync("client/views/Map.tsx", "utf-8");

describe("initial-load resources", () => {
  it("prioritizes and sizes the visible Ferry FYI logo", () => {
    expect(homeSource).toMatch(
      /<img\s+alt="Ferry FYI"\s+className="w-28"\s+fetchPriority="high"\s+height=\{112\}\s+src=\{logo\}\s+width=\{112\}/
    );
    expect(homeSource).toContain('icon_monochrome-256.png');
  });

  it("defers route-only map and font styles", () => {
    expect(indexHtml).not.toContain("api.mapbox.com/mapbox-gl-js");
    expect(indexHtml).toContain('media="print"');
    expect(mapSource).toContain('import "mapbox-gl/dist/mapbox-gl.css";');
  });
});
