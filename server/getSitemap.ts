import { DateTime } from "luxon";
import { entries } from "shared/lib/objects";
import { isEmpty } from "shared/lib/arrays";
import { SitemapStream, streamToPromise } from "sitemap";
import { Terminal } from "~/models/Terminal";
import logger from "heroku-logger";

let sitemap: Buffer;

export const getTitle = (
  terminal: Terminal,
  mate: Terminal,
  date?: DateTime
): string => {
  let dateSegment: string = "";
  if (date) {
    const today = DateTime.local();
    const isToday = date.toISODate() === today.toISODate();

    const formattedDate = [date.toFormat("ccc")];

    if (date.month !== today.month) {
      formattedDate.push(date.toFormat("MMM"));
    }

    formattedDate.push(date.toFormat("d"));

    if (date.year !== today.year) {
      formattedDate.push(date.toFormat("y"));
    }

    if (!isToday) {
      dateSegment = ` on ${formattedDate.join(" ")}`;
    }
  }

  return `${terminal.name} to ${mate.name}${dateSegment} - Ferry FYI`;
};

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

  logger.info("Generating sitemap...");
  terminals.forEach(([, terminal]) => {
    terminal.mates.forEach((mate) => {
      logger.info(getTitle(terminal, mate));

      // sync from server.ts
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
