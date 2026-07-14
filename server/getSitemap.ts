import logger from "heroku-logger";
import { isEmpty } from "shared/lib/arrays";
import { entries } from "shared/lib/objects";
import {
  getRouteSeoMetadata,
  getTerminalSeoMetadata,
  SEO_INDEXABLE_PATHS,
} from "shared/lib/seo";
import { SitemapStream, streamToPromise } from "sitemap";

import { Terminal } from "~/models/Terminal";

let sitemap: Buffer;

export const getSitemapUrls = (terminals: Terminal[]): string[] => {
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

  if (isEmpty(terminals)) {
    throw new Error();
  }

  logger.info("Generating sitemap...");
  getSitemapUrls(terminals).forEach((url) => stream.write({ url }));

  stream.end();
  return streamToPromise(stream);
};
