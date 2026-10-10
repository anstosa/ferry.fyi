import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import TERMINAL_OVERRIDES from "../../shared/data/terminals.json";
import WSF_CORE from "../../shared/data/wsf-core.json";
import {
  auditIndexableSeoDescriptions,
  getRouteSeoMetadata,
  SEO_CONTENT_LAST_MODIFIED,
  SEO_DESCRIPTION_TARGET_MAX_LENGTH,
  SEO_DESCRIPTION_TARGET_MIN_LENGTH,
  type SeoRouteTerminal,
} from "../../shared/lib/seo";

interface CorpusTerminal extends SeoRouteTerminal {
  id: string;
  mates: CorpusTerminal[];
}

const terminalOverrides = TERMINAL_OVERRIDES as Record<
  string,
  { slug: string }
>;

/** build canonical terminal relationships from checked-in WSF data */
const getCorpusTerminals = (): CorpusTerminal[] => {
  // map checked-in terminal names and slugs
  const terminals: CorpusTerminal[] = Object.entries(WSF_CORE.terminals).map(
    ([id, data]) => ({
      id,
      mates: [],
      name: data.name.trim(),
      slug: terminalOverrides[id].slug,
    })
  );
  // index terminals for relationship assembly
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));

  // attach every directional route mate
  Object.values(WSF_CORE.routes).forEach(({ terminalIds }) => {
    // populate each departure terminal independently
    terminalIds.forEach((terminalId) => {
      const terminal = byId.get(terminalId);

      // guard checked-in route integrity
      if (!terminal) {
        throw new Error(`Missing terminal ${terminalId}`);
      }
      terminal.mates.push(
        ...terminalIds
          .filter((mateId) => mateId !== terminalId)
          .map((mateId) => {
            const mate = byId.get(mateId);

            // guard checked-in mate integrity
            if (!mate) {
              throw new Error(`Missing route mate ${mateId}`);
            }
            return mate;
          })
      );
    });
  });

  return terminals;
};

describe("directional schedule wait SEO", () => {
  // lock the public wait-first metadata promise
  it("uses factual wait-first title and description copy", () => {
    const metadata = getRouteSeoMetadata(
      { mates: [{}], name: "Seattle", slug: "seattle" },
      { name: "Bainbridge Island", slug: "bainbridge-island" }
    );

    expect(metadata).toMatchObject({
      canonicalPath: "/seattle",
      robots: "index,follow",
      title:
        "Seattle to Bainbridge Island Ferry Wait Times & Schedule - Ferry FYI",
    });
    expect(metadata.description).toContain("WSF wait reports");
    expect(metadata.description).toContain("departures");
    expect(metadata.description).toContain("capacity forecasts");
    expect(metadata.description).toContain("cameras");
    expect(metadata.description).toContain("alerts");
    expect(metadata.description).toContain("timestamps vary");
    expect(metadata.description).toContain("Boarding is not guaranteed");
    expect(metadata.description).not.toMatch(/exact|live numeric/i);
  });

  // audit every checked-in direction and description
  it("keeps the route corpus unique and within the editorial target", () => {
    const entries = getCorpusTerminals().flatMap((terminal) =>
      terminal.mates.map((mate) => getRouteSeoMetadata(terminal, mate))
    );
    const canonicalPaths = entries.map(({ canonicalPath }) => canonicalPath);
    const descriptions = entries.map(({ canonicalPath, description }) => ({
      canonicalPath,
      description,
    }));

    expect(new Set(canonicalPaths).size).toBe(canonicalPaths.length);
    expect(auditIndexableSeoDescriptions(descriptions).targetUrls).toEqual(
      canonicalPaths
    );
    entries.forEach(({ description, title }) => {
      expect(title).toMatch(/ Ferry Wait Times & Schedule - Ferry FYI$/);
      expect(description.length).toBeGreaterThanOrEqual(
        SEO_DESCRIPTION_TARGET_MIN_LENGTH
      );
      expect(description.length).toBeLessThanOrEqual(
        SEO_DESCRIPTION_TARGET_MAX_LENGTH
      );
    });
  });

  // preserve dated and navigation exclusions
  it("retains canonical and noindex policy for noncanonical variants", () => {
    const departure = {
      mates: [{}, {}],
      name: "Seattle",
      slug: "seattle",
    };
    const arrival = {
      name: "Bainbridge Island",
      slug: "bainbridge-island",
    };

    expect(getRouteSeoMetadata(departure, arrival)).toMatchObject({
      canonicalPath: "/seattle/bainbridge-island",
      robots: "index,follow",
    });
    expect(
      getRouteSeoMetadata(departure, arrival, "schedule", true)
    ).toMatchObject({
      canonicalPath: "/seattle/bainbridge-island",
      robots: "noindex,follow",
    });
    expect(getRouteSeoMetadata(departure, arrival, "navigation")).toMatchObject(
      {
        canonicalPath: "/seattle/bainbridge-island/navigation",
        robots: "noindex,follow",
      }
    );
  });

  // align operations guidance with visible content claims
  it("documents reports, forecasts, dates, timestamps, and schema limits", () => {
    const operations = readFileSync("docs/seo-operations.md", "utf8");

    expect(SEO_CONTENT_LAST_MODIFIED).toBe("2026-10-09");
    expect(operations).toContain("Directional schedule wait-first contract");
    expect(operations).toContain("initial HTML");
    expect(operations).toContain("WSF wait reports are reports");
    expect(operations).toContain(
      "WSF-reported capacity counts are observations"
    );
    expect(operations).toContain(
      "Ferry FYI capacity forecasts are predictions"
    );
    expect(operations).toContain("Neither is a measured queue wait");
    expect(operations).toContain("non-default `date`");
    expect(operations).toContain("source timestamps");
    expect(operations).toContain("Do not add FAQ schema");
    expect(operations).toContain(
      "https://developers.google.com/search/docs/appearance/title-link"
    );
    expect(operations).toContain(
      "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics"
    );
    expect(operations).not.toMatch(/guarantee(?:d)? (?:search )?rankings/i);
  });
});
