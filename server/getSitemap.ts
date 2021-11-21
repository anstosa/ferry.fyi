import { entries } from "shared/lib/objects";
import { isEmpty } from "shared/lib/arrays";
import { SitemapStream, streamToPromise } from "sitemap";
import { Terminal } from "~/models/Terminal";
import logger from "heroku-logger";

let sitemap: Buffer;

export const getSitemap = async (): Promise<Buffer> => {
  if (sitemap) {
    return sitemap;
  }
  const stream = new SitemapStream({ hostname: "https://ferry.fyi/" });

  stream.write({ url: "/" });
  stream.write({ url: "/about" });
  stream.write({ url: "/feedback" });

  const terminals = entries(await Terminal.getAll());

  if (isEmpty(terminals)) {
    throw new Error();
  }

  terminals.forEach(([, terminal]) => {
    terminal.mates.forEach((mate) => {
      logger.info(`${terminal.abbreviation} -> ${mate.abbreviation}`);

      stream.write({
        url: `/${terminal.slug}/${
          terminal.mates.length === 1 ? "" : mate.slug
        }`,
      });
    });
  });

  // cache the response
  // eslint-disable-next-line require-atomic-updates
  streamToPromise(stream).then((result) => (sitemap = result));
  stream.end();
  return sitemap;
};
