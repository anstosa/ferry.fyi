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
} from "shared/lib/seo";
import { SitemapStream, streamToPromise } from "sitemap";

import { leaderboardsEnabled } from "~/lib/leaderboardFlags";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";

let sitemap: Buffer;

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

export const getSitemap = async (): Promise<Buffer> => {
  if (sitemap) {
    return sitemap;
  }
  const generatedSitemap = await generateSitemap();
  // cache the completed first request, rather than its pending promise
  // eslint-disable-next-line require-atomic-updates
  sitemap = generatedSitemap;
  return sitemap;
};

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
  getSitemapUrls(terminals, vessels, await leaderboardsEnabled()).forEach(
    (url) => stream.write({ lastmod: SEO_CONTENT_LAST_MODIFIED, url })
  );

  stream.end();
  return streamToPromise(stream);
};
