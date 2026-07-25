import { describe, expect, it, vi } from "vitest";

import { getSitemap, getSitemapUrls } from "../../server/getSitemap";
import { Terminal } from "../../server/models/Terminal";
import {
  getRouteSeoMetadata,
  getTerminalSeoMetadata,
  SEO_CONTENT_LAST_MODIFIED,
} from "../../shared/lib/seo";

describe("sitemap URLs", () => {
  it("includes only indexable static, route, and renderable terminal pages", () => {
    const bainbridge = {
      name: "Bainbridge Island",
      slug: "bainbridge-island",
      mates: [] as any[],
    };
    const seattle = {
      name: "Seattle",
      slug: "seattle",
      mates: [bainbridge],
    };
    bainbridge.mates = [seattle];
    const orphan = { name: "Orphan", slug: "orphan", mates: [] as any[] };

    expect(getSitemapUrls([seattle, bainbridge, orphan] as any)).toEqual([
      "/",
      "/about",
      "/forecasting",
      "/data-sources",
      "/seattle",
      "/seattle/terminal",
      "/bainbridge-island",
      "/bainbridge-island/terminal",
    ]);
    expect(getSitemapUrls([seattle] as any)).toContain(
      getRouteSeoMetadata(seattle, bainbridge).canonicalPath
    );
    expect(getSitemapUrls([seattle] as any)).toContain(
      getTerminalSeoMetadata(seattle).canonicalPath
    );
  });

  it("includes leaderboard entity URLs only when enabled", () => {
    const terminal = { id: "seattle", mates: [], name: "Seattle", slug: "seattle" };
    const vessel = { id: "kaleetan", name: "Kaleetan" };
    expect(getSitemapUrls([terminal] as any, [vessel] as any, false)).not.toContain(
      "/leaderboards/terminals/seattle"
    );
    expect(getSitemapUrls([terminal] as any, [vessel] as any, true)).toEqual(
      expect.arrayContaining([
        "/leaderboards/terminals/seattle",
        "/leaderboards/vessels/kaleetan",
      ])
    );
  });

  it("emits one terminal canonical per terminal and caches the completed sitemap", async () => {
    Terminal.purge();
    const bainbridge = new Terminal({
      aliases: [],
      id: "bainbridge",
      mates: [],
      name: "Bainbridge Island",
      slug: "bainbridge-island",
    });
    const bremerton = new Terminal({
      aliases: [],
      id: "bremerton",
      mates: [],
      name: "Bremerton",
      slug: "bremerton",
    });
    const seattle = new Terminal({
      aliases: [],
      id: "seattle",
      mates: [bainbridge, bremerton],
      name: "Seattle",
      slug: "seattle",
    });
    bainbridge.mates = [seattle];
    bremerton.mates = [seattle];
    seattle.save();
    bainbridge.save();
    bremerton.save();
    const getAll = vi.spyOn(Terminal, "getAll");

    const first = await getSitemap();
    const second = await getSitemap();

    expect(first).toBe(second);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(first.toString()).toContain("/seattle/terminal");
    expect(first.toString()).toContain(
      `<lastmod>${SEO_CONTENT_LAST_MODIFIED}T00:00:00.000Z</lastmod>`
    );
    expect(first.toString()).not.toContain(
      "/seattle/bainbridge-island/terminal"
    );
  });
});
