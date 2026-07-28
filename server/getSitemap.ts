import logger from "heroku-logger";
import { isEmpty } from "shared/lib/arrays";
import { entries } from "shared/lib/objects";
import {
  getLeaderboardsSeoMetadata,
  getRouteSeoMetadata,
  getTerminalLeaderboardSeoMetadata,
  getTerminalSeoMetadata,
  SEO_CONTENT_LAST_MODIFIED,
  SEO_INDEXABLE_PATHS,
  SEO_INDEXABLE_ROUTE_VIEWS,
} from "shared/lib/seo";
import { SitemapStream, streamToPromise } from "sitemap";

import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";

export const getSitemapUrls = (
  terminals: Terminal[],
  vessels: Vessel[] = [],
  includeLeaderboards = false
): string[] => {
  const urls: string[] = [...SEO_INDEXABLE_PATHS];

  terminals.forEach((terminal) => {
    urls.push(
      ...terminal.mates.map(
        (mate) => getRouteSeoMetadata(terminal, mate).canonicalPath
      ),
      ...terminal.mates.flatMap((mate) =>
        SEO_INDEXABLE_ROUTE_VIEWS.map(
          (view) => getRouteSeoMetadata(terminal, mate, view).canonicalPath
        )
      )
    );
    if (terminal.mates.length > 0) {
      urls.push(getTerminalSeoMetadata(terminal).canonicalPath);
    }
  });

  if (includeLeaderboards) {
    urls.push(
      getLeaderboardsSeoMetadata().canonicalPath,
      ...terminals.map(
        (terminal) => getTerminalLeaderboardSeoMetadata(terminal).canonicalPath
      ),
      ...vessels.map(
        (vessel) => `/leaderboards/vessels/${encodeURIComponent(vessel.id)}`
      )
    );
  }

  return urls;
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
    import("~/lib/admin/content"),
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
