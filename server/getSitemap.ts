import { entries } from "shared/lib/objects";
import { isEmpty } from "shared/lib/arrays";
import { SitemapStream, streamToPromise } from "sitemap";
import { Terminal } from "~/models/Terminal";
import logger from "heroku-logger";

let sitemap: Buffer;

export const getSitemap = async (): Promise<Buffer> => {
  logger.info("1");
  if (sitemap) {
    logger.info("2");
    return sitemap;
  }
  const stream = new SitemapStream({ hostname: "https://ferry.fyi/" });
  logger.info("3");
  logger.info("4");

  stream.write({ url: "/" });
  stream.write({ url: "/about" });
  stream.write({ url: "/feedback" });

  logger.info("5");

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
  logger.info("6");

  // cache the response
  // eslint-disable-next-line require-atomic-updates
  streamToPromise(stream).then((result) => (sitemap = result));
  logger.info("7");
  stream.end();
  logger.info("8");
  return sitemap;
};
