import { describe, expect, it } from "vitest";

import TERMINAL_OVERRIDES from "../../shared/data/terminals.json";
import WSF_CORE from "../../shared/data/wsf-core.json";
import {
  auditIndexableSeoDescriptions,
  getTerminalSeoMetadata,
  SEO_DESCRIPTION_TARGET_MAX_LENGTH,
  SEO_DESCRIPTION_TARGET_MIN_LENGTH,
} from "../../shared/lib/seo";

describe("terminal search-intent metadata", () => {
  // describe answers the terminal page actually provides
  it("uses a terminal-owned parking and directions title", () => {
    const metadata = getTerminalSeoMetadata({
      name: "Seattle",
      slug: "seattle",
    });
    expect(metadata).toMatchObject({
      canonicalPath: "/seattle/terminal",
      robots: "index,follow",
      title: "Seattle Ferry Terminal: Parking & Directions - Ferry FYI",
    });
    expect(metadata.description).toContain(
      "Seattle ferry terminal directions, parking, transit, accessibility and facilities"
    );
    expect(metadata.description).toContain("dated WSF arrival guidance");
    expect(metadata.description).not.toMatch(
      /live wait|current queue|guaranteed/i
    );
    expect(metadata.schema).toMatchObject({
      "@type": "WebPage",
      name: metadata.title,
    });
  });

  // audit the checked-in corpus without touching live providers or a database
  it("keeps every terminal description unique and within the editorial target", () => {
    const overrides = TERMINAL_OVERRIDES as Record<string, { slug: string }>;
    const entries = Object.entries(WSF_CORE.terminals).map(([id, terminal]) =>
      getTerminalSeoMetadata({
        name: terminal.name.trim(),
        slug: overrides[id].slug,
      })
    );
    expect(auditIndexableSeoDescriptions(entries).targetUrls).toHaveLength(
      entries.length
    );
    expect(
      new Set(entries.map(({ canonicalPath }) => canonicalPath)).size
    ).toBe(entries.length);
    // keep copy concise for even the longest terminal name
    entries.forEach(({ description }) => {
      expect(description.length).toBeGreaterThanOrEqual(
        SEO_DESCRIPTION_TARGET_MIN_LENGTH
      );
      expect(description.length).toBeLessThanOrEqual(
        SEO_DESCRIPTION_TARGET_MAX_LENGTH
      );
    });
  });
});
