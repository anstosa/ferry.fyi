import { describe, expect, it } from "vitest";

import TERMINAL_OVERRIDES from "../../shared/data/terminals.json";
import WSF_CORE from "../../shared/data/wsf-core.json";
import {
  auditIndexableSeoDescriptions,
  getRouteSeoMetadata,
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

/** build directional camera routes from checked-in WSF data */
const getCameraRoutes = (): Array<{
  arrival: CorpusTerminal;
  departure: CorpusTerminal;
}> => {
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

  return terminals.flatMap((departure) =>
    departure.mates.map((arrival) => ({ arrival, departure }))
  );
};

describe("directional camera SEO", () => {
  // lock the camera page search-intent promise
  it("describes terminal images, freshness, and queue location context", () => {
    const metadata = getRouteSeoMetadata(
      { mates: [{}], name: "Seattle", slug: "seattle" },
      { name: "Bainbridge Island", slug: "bainbridge-island" },
      "cameras"
    );

    expect(metadata).toMatchObject({
      canonicalPath: "/seattle/cameras",
      description:
        "Check Seattle ferry terminal camera availability for trips to Bainbridge Island. Images, when available, show traffic, not measured waits.",
      robots: "index,follow",
      title: "Seattle to Bainbridge Island Ferry Traffic Cameras - Ferry FYI",
    });
    expect(metadata.schema).toMatchObject({
      "@type": "WebPage",
      name: metadata.title,
    });
  });

  // keep inventoryless terminals free of image availability promises
  it("describes empty Shaw camera inventory without promising images", () => {
    const shawRoute = getCameraRoutes().find(
      ({ arrival, departure }) =>
        departure.name === "Shaw Island" && arrival.name === "Anacortes"
    );

    expect(WSF_CORE.terminals["18"].cameras).toEqual([]);
    // guard the checked-in route fixture
    if (!shawRoute) {
      throw new Error("Missing Shaw Island to Anacortes route");
    }
    const metadata = getRouteSeoMetadata(
      shawRoute.departure,
      shawRoute.arrival,
      "cameras"
    );
    expect(metadata.description).toBe(
      "Check Shaw Island ferry terminal camera availability for trips to Anacortes. Images, when available, show traffic, not measured waits."
    );
    expect(metadata.description).not.toMatch(
      /camera images|image availability|images available/i
    );
    expect(metadata.description).not.toMatch(
      /image check times|freshness|queue-location context/i
    );
  });

  // audit every checked-in camera direction and description
  it("keeps the camera corpus unique and within the editorial target", () => {
    const entries = getCameraRoutes().map(({ arrival, departure }) =>
      getRouteSeoMetadata(departure, arrival, "cameras")
    );
    const canonicalPaths = entries.map(({ canonicalPath }) => canonicalPath);

    expect(new Set(canonicalPaths).size).toBe(canonicalPaths.length);
    expect(auditIndexableSeoDescriptions(entries).targetUrls).toEqual(
      canonicalPaths
    );
    // preserve concise, directional camera metadata
    entries.forEach(({ description, robots, title }) => {
      expect(robots).toBe("index,follow");
      expect(title).toMatch(/ Ferry Traffic Cameras - Ferry FYI$/);
      expect(description.length).toBeGreaterThanOrEqual(
        SEO_DESCRIPTION_TARGET_MIN_LENGTH
      );
      expect(description.length).toBeLessThanOrEqual(
        SEO_DESCRIPTION_TARGET_MAX_LENGTH
      );
    });
  });

  // preserve canonical URLs while excluding dated variants
  it("noindexes dated camera copies against the undated canonical", () => {
    getCameraRoutes().forEach(({ arrival, departure }) => {
      const undated = getRouteSeoMetadata(departure, arrival, "cameras");
      const dated = getRouteSeoMetadata(departure, arrival, "cameras", true);

      expect(undated.robots).toBe("index,follow");
      expect(dated).toMatchObject({
        canonicalPath: undated.canonicalPath,
        robots: "noindex,follow",
      });
    });
  });

  // reject unsupported real-time and rich-result claims
  it("avoids camera claims the page cannot substantiate", () => {
    getCameraRoutes().forEach(({ arrival, departure }) => {
      const metadata = getRouteSeoMetadata(departure, arrival, "cameras");
      const searchableCopy = `${metadata.title} ${metadata.description}`;

      expect(searchableCopy).not.toMatch(
        /live video|current vehicle[- ]count/i
      );
      expect(searchableCopy).toContain("not measured waits");
      expect(searchableCopy.match(/camera/gi)).toHaveLength(2);
      expect(JSON.stringify(metadata.schema)).not.toContain("FAQPage");
    });
  });
});
