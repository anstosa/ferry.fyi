import { DateTime } from "luxon";
import { entries } from "shared/lib/objects";
import { promises as fs } from "fs";
import { getSitemap, getTitle } from "~/getSitemap";
import { Router } from "express";
import { Terminal } from "~/models/Terminal";
import path from "path";

export const clientDist = path.resolve(
  __dirname,
  "../",
  process.env.NODE_ENV === "development" ? "../../dist/" : "",
  "client/"
);

const browserRouter = Router();

browserRouter.get("/robots.txt", (request, response) => {
  response.type("text/plain");
  return response.send("User-agent: *\nAllow: /");
});

browserRouter.get("/sitemap.xml", async (request, response) => {
  const sitemap = await getSitemap();
  response.type("text/xml");
  return response.send(sitemap);
});

browserRouter.get(".well-known/assetlinks.json", async (request, response) => {
  response.type("application/json");
  return response.send([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "fyi.ferry",
        sha256_cert_fingerprints: [process.env.ANDROID_CERT_FINGERPRINT],
      },
    },
  ]);
});

browserRouter.get(/.*/, async (request, response) => {
  // sync from webpack.config.ts
  const DEFAULT_TITLE = /Ferry FYI - Seattle Area Ferry Schedule and Tracker/g;

  let title: string | undefined;
  const terminalMatch = request.path.match(/^\/(\w+)\/?(\w*)\/?$/);
  if (terminalMatch) {
    const [, terminalSlug, mateSlug] = terminalMatch;
    const terminals: Terminal[] = entries(Terminal.getAll()).map(
      ([, terminal]) => terminal
    );
    const terminal = terminals.find(
      ({ slug, aliases }) =>
        slug === terminalSlug || aliases.includes(terminalSlug)
    );
    if (terminal) {
      const mate =
        terminals.find(
          ({ slug, aliases }) => slug === mateSlug || aliases.includes(mateSlug)
        ) || terminal.mates[0];

      const { date: dateInput } = request.query;

      if (dateInput) {
        const date = DateTime.fromISO(dateInput as string);
        title = getTitle(terminal, mate, date);
      } else {
        title = getTitle(terminal, mate);
      }
    }
  }

  const data = (
    await fs.readFile(path.resolve(clientDist, "index.html"))
  ).toString("utf-8");
  response.type("text/html");
  if (!title) {
    return response.send(data);
  }
  return response.send(
    data
      .replace(DEFAULT_TITLE, title)
      .replace(
        `rel="canonical" href="${process.env.BASE_URL}"`,
        `rel="canonical" href="${process.env.BASE_URL}${request.path}"`
      )
      .replace(
        `property="og:url" content="${process.env.BASE_URL}"`,
        `property="og:url" content="${process.env.BASE_URL}${request.path}"`
      )
  );
});

export { browserRouter };
