import { describe, expect, it, vi } from "vitest";

import {
  getSitemap,
  getSitemapSeoEntries,
  getSitemapUrls,
} from "../../server/getSitemap";
import { Terminal } from "../../server/models/Terminal";
import TERMINAL_OVERRIDES from "../../shared/data/terminals.json";
import VESSEL_OVERRIDES from "../../shared/data/vessels.json";
import WSF_CORE from "../../shared/data/wsf-core.json";
import {
  auditIndexableSeoDescriptions,
  getHowManyBoatsSeoMetadata,
  getRouteSeoMetadata,
  getTerminalSeoMetadata,
  SEO_CONTENT_LAST_MODIFIED,
  SEO_INDEXABLE_PATHS,
  SEO_INDEXABLE_ROUTE_VIEWS,
} from "../../shared/lib/seo";
import { PUBLIC_SSR_ROUTE_MANIFEST } from "../../shared/lib/ssrRoutes";

describe("sitemap URLs", () => {
  it("keeps sitemap fixed paths and route tabs aligned with the sole SSR manifest", () => {
    const manifestPaths = new Set(
      PUBLIC_SSR_ROUTE_MANIFEST.map(({ path }) => path)
    );
    SEO_INDEXABLE_PATHS.forEach((path) =>
      expect(manifestPaths.has(path)).toBe(true)
    );

    const manifestIndexableViews = new Set(
      PUBLIC_SSR_ROUTE_MANIFEST.filter(
        ({ indexabilityPolicy, view }) =>
          indexabilityPolicy === "seo" &&
          view !== undefined &&
          view !== "schedule" &&
          view !== "terminal"
      ).map(({ view }) => view)
    );
    expect([...manifestIndexableViews].sort()).toEqual(
      [...SEO_INDEXABLE_ROUTE_VIEWS].sort()
    );
  });

  it("audits every generated canonical URL in the checked-in WSF corpus", () => {
    const terminals = Object.entries(WSF_CORE.terminals).map(([id, data]) => ({
      id,
      mates: [] as any[],
      name: data.name,
      slug: TERMINAL_OVERRIDES[id as keyof typeof TERMINAL_OVERRIDES].slug,
    }));
    const byId = Object.fromEntries(
      terminals.map((terminal) => [terminal.id, terminal])
    );
    Object.values(WSF_CORE.routes).forEach(({ terminalIds }) => {
      terminalIds.forEach((terminalId) => {
        byId[terminalId].mates.push(
          ...terminalIds
            .filter((mateId) => mateId !== terminalId)
            .map((mateId) => byId[mateId])
        );
      });
    });

    const vessels = Object.keys(VESSEL_OVERRIDES).map((id) => ({
      id,
      name: `Vessel ${id}`,
    }));
    const entries = getSitemapSeoEntries(
      terminals as any,
      vessels as any,
      true
    );
    const audit = auditIndexableSeoDescriptions(entries);
    const urls = entries.map(({ canonicalPath }) => canonicalPath);
    expect(new Set(urls).size).toBe(urls.length);
    expect(audit).toEqual({
      reviewedLongUrls: [],
      shortRationaleUrls: [],
      targetUrls: urls,
    });

    const howManyBoats = getHowManyBoatsSeoMetadata();
    expect(
      auditIndexableSeoDescriptions([
        {
          canonicalPath: "https://howmanyboats.today/",
          description: howManyBoats.description,
        },
      ]).targetUrls
    ).toEqual(["https://howmanyboats.today/"]);
  });

  it("rejects empty, duplicate, short, and unreviewed long descriptions", () => {
    expect(() =>
      auditIndexableSeoDescriptions([
        { canonicalPath: "/empty", description: "  " },
        { canonicalPath: "/short", description: "Too short" },
        {
          canonicalPath: "/duplicate-a",
          description: "A".repeat(120),
        },
        {
          canonicalPath: "/duplicate-b",
          description: `  ${"a".repeat(120)}  `,
        },
        {
          canonicalPath: "/long",
          description: "Long editorial description ".repeat(9),
        },
      ])
    ).toThrow(
      /empty description[\s\S]*description is 9 characters[\s\S]*duplicates \/duplicate-a[\s\S]*needs editorial review/
    );
  });

  it("accepts reviewed exceptions and rejects stale review keys", () => {
    const short = "S".repeat(110);
    const long = "L".repeat(181);
    expect(
      auditIndexableSeoDescriptions(
        [
          { canonicalPath: "/short", description: short },
          { canonicalPath: "/long", description: long },
        ],
        {
          longReviewNotes: { "/long": "Reviewed for required legal accuracy." },
          shortRationales: { "/short": "Concise product name is required." },
        }
      )
    ).toEqual({
      reviewedLongUrls: ["/long"],
      shortRationaleUrls: ["/short"],
      targetUrls: [],
    });
    expect(() =>
      auditIndexableSeoDescriptions(
        [{ canonicalPath: "/target", description: "T".repeat(130) }],
        {
          longReviewNotes: { "/removed": "Stale review." },
          shortRationales: { "/missing": "Stale rationale." },
        }
      )
    ).toThrow(
      /\/missing: stale short-description rationale[\s\S]*\/removed: stale long-description review/
    );
  });

  it("includes only indexable static, route-tab, and renderable terminal pages", () => {
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

    expect(getSitemapUrls([seattle, bainbridge, orphan] as any)).toEqual(
      expect.arrayContaining([
        "/",
        "/tickets",
        "/privacy",
        "/support",
        "/seattle",
        "/seattle/terminal",
        "/bainbridge-island",
        "/bainbridge-island/terminal",
        ...SEO_INDEXABLE_ROUTE_VIEWS.map((view) => `/seattle/${view}`),
        ...SEO_INDEXABLE_ROUTE_VIEWS.map(
          (view) => `/bainbridge-island/${view}`
        ),
      ])
    );
    expect(getSitemapUrls([seattle, bainbridge, orphan] as any)).toHaveLength(
      SEO_INDEXABLE_PATHS.length + 2 * (2 + SEO_INDEXABLE_ROUTE_VIEWS.length)
    );
    expect(getSitemapUrls([seattle] as any)).toContain(
      getRouteSeoMetadata(seattle, bainbridge).canonicalPath
    );
    expect(getSitemapUrls([seattle] as any)).toContain(
      getTerminalSeoMetadata(seattle).canonicalPath
    );
  });

  it("includes leaderboard entity URLs only when enabled", () => {
    const terminal = {
      id: "seattle",
      mates: [],
      name: "Seattle",
      slug: "seattle",
    };
    const vessel = { id: "kaleetan", name: "Kaleetan" };
    expect(
      getSitemapUrls([terminal] as any, [vessel] as any, false)
    ).not.toContain("/leaderboards/terminals/seattle");
    expect(getSitemapUrls([terminal] as any, [vessel] as any, true)).toEqual(
      expect.arrayContaining([
        "/leaderboards/terminals/seattle",
        "/leaderboards/vessels/kaleetan",
      ])
    );
  });

  it("emits one terminal canonical per terminal without process-local caching", async () => {
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

    expect(first).not.toBe(second);
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(first.toString()).toContain("/seattle/terminal");
    expect(first.toString()).toContain(
      `<lastmod>${SEO_CONTENT_LAST_MODIFIED}T00:00:00.000Z</lastmod>`
    );
    expect(first.toString()).not.toContain(
      "/seattle/bainbridge-island/terminal"
    );
  });
});
