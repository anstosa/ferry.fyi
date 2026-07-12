import { Router } from "express";
import { existsSync, promises as fs } from "fs";
import { DateTime } from "luxon";
import path from "path";
import { entries } from "shared/lib/objects";

import { getSitemap, getTitle } from "~/getSitemap";
import { Terminal } from "~/models/Terminal";

// published Play signing certificates
const ANDROID_APP_LINK_CERT_FINGERPRINTS = [
  "83:33:A0:5D:80:9C:57:19:7E:9B:64:17:7C:4F:08:8A:9F:AD:91:76:97:D2:C0:52:12:6C:87:80:63:A0:31:F2",
  "DA:FB:7E:B4:7F:20:3F:EF:78:F1:A5:DB:72:4B:1D:81:27:A8:0E:CA:4B:ED:0E:3D:03:60:0C:8D:40:0A:7A:D3",
];

const bundledClientDist = path.resolve(__dirname, "../client");
const sourceClientDist = path.resolve(__dirname, "../../../dist/client");

export const clientDist = existsSync(bundledClientDist)
  ? bundledClientDist
  : sourceClientDist;

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

browserRouter.get("/.well-known/assetlinks.json", (request, response) => {
  // serve the Play certificate association
  response.type("application/json");
  return response.send([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "fyi.ferry",
        sha256_cert_fingerprints: ANDROID_APP_LINK_CERT_FINGERPRINTS,
      },
    },
  ]);
});

browserRouter.get(/.*/, async (request, response) => {
  // sync from vite config
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

      if (mate) {
        const { date: dateInput } = request.query;

        if (dateInput) {
          const date = DateTime.fromISO(dateInput as string);
          title = getTitle(terminal, mate, date);
        } else {
          title = getTitle(terminal, mate);
        }
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
