import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync("client/index.html", "utf-8");

describe("viewport metadata", () => {
  it("allows browser zoom", () => {
    const viewportTag = indexHtml.match(/<meta\s+name="viewport"[\s\S]*?\/>/)?.[0];

    expect(viewportTag).toContain("width=device-width");
    expect(viewportTag).not.toMatch(/maximum-scale|user-scalable/i);
  });
});
