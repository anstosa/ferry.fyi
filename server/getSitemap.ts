import logger from "heroku-logger";
import { isEmpty } from "shared/lib/arrays";
import { entries } from "shared/lib/objects";
import {
  auditIndexableSeoDescriptions,
  getLeaderboardsSeoMetadata,
  getRouteSeoMetadata,
  getSeoMetadata,
  getTerminalLeaderboardSeoMetadata,
  getTerminalSeoMetadata,
  getVesselLeaderboardSeoMetadata,
  SEO_CONTENT_LAST_MODIFIED,
  SEO_INDEXABLE_PATHS,
  SEO_INDEXABLE_ROUTE_VIEWS,
  type SeoDescriptionAuditEntry,
} from "shared/lib/seo";
import { SitemapStream, streamToPromise } from "sitemap";

import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";

export const getSitemapSeoEntries = (
  terminals: Terminal[],
  vessels: Vessel[] = [],
  includeLeaderboards = false
): SeoDescriptionAuditEntry[] => {
  const metadata: SeoDescriptionAuditEntry[] = SEO_INDEXABLE_PATHS.map(
    (canonicalPath) => ({
      canonicalPath,
      description: getSeoMetadata(canonicalPath).description,
    })
  );

  terminals.forEach((terminal) => {
    metadata.push(
      ...terminal.mates.map((mate) => getRouteSeoMetadata(terminal, mate)),
      ...terminal.mates.flatMap((mate) =>
        SEO_INDEXABLE_ROUTE_VIEWS.map((view) =>
          getRouteSeoMetadata(terminal, mate, view)
        )
      )
    );
    if (terminal.mates.length > 0) {
      metadata.push(getTerminalSeoMetadata(terminal));
    }
  });

  if (includeLeaderboards) {
    metadata.push(
      getLeaderboardsSeoMetadata(),
      ...terminals.map((terminal) =>
        getTerminalLeaderboardSeoMetadata(terminal)
      ),
      ...vessels.map((vessel) => getVesselLeaderboardSeoMetadata(vessel))
    );
  }

  return metadata;
};

export const getSitemapUrls = (
  terminals: Terminal[],
  vessels: Vessel[] = [],
  includeLeaderboards = false
): string[] => {
  const metadata = getSitemapSeoEntries(
    terminals,
    vessels,
    includeLeaderboards
  );
  auditIndexableSeoDescriptions(metadata);
  return metadata.map(({ canonicalPath }) => canonicalPath);
};

/**
 * Do not cache this in module state: public controls may be changed on a
 * different dyno. Each response reads the persisted policy before generating.
 */
export const getSitemap = (): Promise<Buffer> => generateSitemap();

const generateSitemap = async (): Promise<Buffer> => {
  const stream = new SitemapStream({ hostname: "https://ferry.fyi/" });

  const terminals = entries(await Terminal.getAll()).map(
    ([, terminal]) => terminal
  );
  const vessels = entries(Vessel.getAll()).map(([, vessel]) => vessel);

  if (isEmpty(terminals)) {
    throw new Error();
  }

  logger.info("Generating sitemap...");
  const [{ getPublicContent }, { isPublicFeatureEnabled }] = await Promise.all([
    import("~/services/public/content"),
    import("~/lib/leaderboardFlags"),
  ]);
  const [leaderboardsEnabled, publicContent] = await Promise.all([
    isPublicFeatureEnabled("leaderboards"),
    getPublicContent(),
  ]);
  getSitemapUrls(
    terminals,
    vessels,
    leaderboardsEnabled && publicContent.leaderboardIndexingEnabled
  ).forEach((url) => stream.write({ lastmod: SEO_CONTENT_LAST_MODIFIED, url }));

  stream.end();
  return streamToPromise(stream);
};
