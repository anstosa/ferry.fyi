import { Router } from "express";
import { existsSync, readFileSync } from "fs";
import { DateTime } from "luxon";
import path from "path";
import { entries } from "shared/lib/objects";
import {
  getDatedSeoTitle,
  getRouteSeoMetadata,
  getSeoProfile,
  getSeoSchema,
  getSeoUrl,
  getTerminalSeoMetadata,
  SEO_APP_NAME,
  SEO_ROUTE_VIEWS,
  type SeoMetadata,
  type SeoView,
} from "shared/lib/seo";

import { getSitemap } from "~/getSitemap";
import { Terminal } from "~/models/Terminal";

// published Play signing certificates
const ANDROID_APP_LINK_CERT_FINGERPRINTS = [
  "83:33:A0:5D:80:9C:57:19:7E:9B:64:17:7C:4F:08:8A:9F:AD:91:76:97:D2:C0:52:12:6C:87:80:63:A0:31:F2",
  "DA:FB:7E:B4:7F:20:3F:EF:78:F1:A5:DB:72:4B:1D:81:27:A8:0E:CA:4B:ED:0E:3D:03:60:0C:8D:40:0A:7A:D3",
];
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const bundledClientDist = path.resolve(__dirname, "../client");
const sourceClientDist = path.resolve(__dirname, "../../../dist/client");
const APP_PATHS = new Set([
  "/",
  "/about",
  "/account",
  "/callback",
  "/feedback",
  "/forecasting",
  "/privacy",
  "/tickets",
  "/today",
]);

export const clientDist = existsSync(bundledClientDist)
  ? bundledClientDist
  : sourceClientDist;

const escapeHtml = (input: string): string =>
  input.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);

const getSeoFallbackHtml = (seo: SeoMetadata, canonicalUrl: string): string => {
  if (seo.robots !== "index,follow") {
    return "";
  }

  const heading = escapeHtml(seo.title.replace(` - ${SEO_APP_NAME}`, ""));

  return `<main aria-labelledby="seo-page-title" data-seo-seed="true" style="background:#fff;color:#1f2937;min-height:100%;padding:2rem 1rem"><h1 id="seo-page-title">${heading}</h1><p>${escapeHtml(seo.description)}</p><p><a href="${canonicalUrl}">View the live ferry schedule and service information</a></p></main>`;
};

export const renderSeoHtml = (
  template: string,
  seo: SeoMetadata,
  baseUrl: string
): string => {
  const canonicalUrl = getSeoUrl(baseUrl, seo.canonicalPath);
  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const schema = JSON.stringify(getSeoSchema(seo, baseUrl)).replace(
    /</g,
    "\\u003c"
  );

  const replacements: Array<[RegExp, string]> = [
    [
      /<title(?: data-seo-seed="true")?>.*?<\/title>/,
      `<title data-seo-seed="true">${title}</title>`,
    ],
    [
      /<meta\b(?=[^>]*\bname="description")[^>]*\/>/,
      `<meta data-seo-seed="true" name="description" content="${description}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bname="robots")[^>]*\/>/,
      `<meta data-seo-seed="true" name="robots" content="${seo.robots}" />`,
    ],
    [
      /<link\b(?=[^>]*\brel="canonical")[^>]*>/,
      `<link data-seo-seed="true" rel="canonical" href="${canonicalUrl}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bname="twitter:title")[^>]*\/>/,
      `<meta data-seo-seed="true" name="twitter:title" content="${title}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bname="twitter:description")[^>]*\/>/,
      `<meta data-seo-seed="true" name="twitter:description" content="${description}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bproperty="og:url")[^>]*\/>/,
      `<meta data-seo-seed="true" property="og:url" content="${canonicalUrl}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bproperty="og:title")[^>]*\/>/,
      `<meta data-seo-seed="true" property="og:title" content="${title}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bproperty="og:description")[^>]*\/>/,
      `<meta data-seo-seed="true" property="og:description" content="${description}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bitemprop="name")[^>]*\/>/,
      `<meta data-seo-seed="true" itemprop="name" content="${title}" />`,
    ],
    [
      /<meta\b(?=[^>]*\bitemprop="description")[^>]*\/>/,
      `<meta data-seo-seed="true" itemprop="description" content="${description}" />`,
    ],
    [
      /<script\b(?=[^>]*\bid="structured-data")[^>]*>[\s\S]*?<\/script>/,
      `<script data-seo-seed="true" id="structured-data" type="application/ld+json">${schema}</script>`,
    ],
    [
      /<div\b(?=[^>]*\bid="seo-content")[^>]*><\/div>/,
      `<div data-seo-seed="true" id="seo-content">${getSeoFallbackHtml(seo, canonicalUrl)}</div>`,
    ],
  ];

  return replacements.reduce(
    (html, [pattern, replacement]) => html.replace(pattern, replacement),
    template
  );
};

export const createBrowserRouter = (dist = clientDist): Router => {
  const browserRouter = Router();
  const indexHtml = readFileSync(path.resolve(dist, "index.html"), "utf-8");

  browserRouter.get("/robots.txt", (request, response) => {
    response.type("text/plain");
    return response.sendFile(path.resolve(dist, "robots.txt"));
  });

  browserRouter.get("/llms.txt", (request, response) => {
    response.type("text/plain");
    return response.sendFile(path.resolve(dist, "llms.txt"));
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

  browserRouter.get(/.*/, (request, response) => {
    const requestHost = request.hostname;
    const terminalMatch = request.path.match(
      /^\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/
    );
    let metadata: SeoMetadata | undefined;
    let isDated = false;
    const { baseUrl: seoProfileBaseUrl, metadata: seoProfileMetadata } =
      getSeoProfile(requestHost, request.path);
    let baseUrl = "https://ferry.fyi";
    if (process.env.BASE_URL?.startsWith("http")) {
      baseUrl = process.env.BASE_URL;
    }
    if (seoProfileBaseUrl) {
      baseUrl = seoProfileBaseUrl;
    }
    if (seoProfileBaseUrl) {
      metadata = seoProfileMetadata;
    } else if (terminalMatch) {
      const [, terminalSlug, secondSegment, thirdSegment] = terminalMatch;
      const terminals: Terminal[] = entries(Terminal.getAll()).map(
        ([, terminal]) => terminal
      );
      const terminal = terminals.find(
        ({ slug, aliases }) =>
          slug === terminalSlug || aliases.includes(terminalSlug)
      );
      if (terminal) {
        const routeView =
          secondSegment && SEO_ROUTE_VIEWS.includes(secondSegment as SeoView)
            ? (secondSegment as SeoView)
            : undefined;
        const nestedView =
          thirdSegment && SEO_ROUTE_VIEWS.includes(thirdSegment as SeoView)
            ? (thirdSegment as SeoView)
            : undefined;
        const mateSlug = !thirdSegment && routeView ? undefined : secondSegment;
        const view = thirdSegment ? nestedView : (routeView ?? "schedule");
        const mate = mateSlug
          ? terminals.find(
              ({ slug, aliases }) =>
                slug === mateSlug || aliases.includes(mateSlug)
            )
          : terminal.mates[0];
        isDated =
          typeof request.query.date === "string" &&
          DateTime.fromISO(request.query.date).isValid;
        const isValidMate = Boolean(
          mate && terminal.mates.some(({ id }) => id === mate.id)
        );

        const isCanonicalTerminalPath =
          secondSegment === "terminal" && !thirdSegment;

        if (isCanonicalTerminalPath && terminal.mates.length > 0) {
          metadata = getTerminalSeoMetadata(terminal);
        } else if (mate && isValidMate && view && view !== "terminal") {
          metadata = getRouteSeoMetadata(terminal, mate, view, isDated);
        }
      }
    }

    const normalizedPath =
      request.path === "/" ? "/" : request.path.replace(/\/$/, "");
    if (normalizedPath === "/forecasting-explained") {
      return response.redirect(301, "/forecasting");
    }
    if (!seoProfileBaseUrl && !metadata && !APP_PATHS.has(normalizedPath)) {
      return response
        .status(404)
        .type("text/html")
        .send(renderSeoHtml(indexHtml, seoProfileMetadata, baseUrl));
    }

    if (
      !seoProfileBaseUrl &&
      metadata &&
      !isDated &&
      normalizedPath !== metadata.canonicalPath &&
      request.query.date === undefined
    ) {
      return response.redirect(301, metadata.canonicalPath);
    }

    response.type("text/html");
    const seo = metadata ?? seoProfileMetadata;
    const dateLabel = isDated ? getDateLabel(request.query.date) : undefined;
    const title = getDatedSeoTitle(seo, dateLabel);
    return response.send(renderSeoHtml(indexHtml, { ...seo, title }, baseUrl));
  });

  return browserRouter;
};

const getDateLabel = (date: unknown): string | undefined => {
  if (typeof date !== "string") {
    return undefined;
  }
  const parsedDate = DateTime.fromISO(date);
  const today = DateTime.local();
  if (!parsedDate.isValid || parsedDate.toISODate() === today.toISODate()) {
    return undefined;
  }
  const formattedDate = [parsedDate.toFormat("ccc")];
  if (parsedDate.month !== today.month) {
    formattedDate.push(parsedDate.toFormat("MMM"));
  }
  formattedDate.push(parsedDate.toFormat("d"));
  if (parsedDate.year !== today.year) {
    formattedDate.push(parsedDate.toFormat("y"));
  }
  return formattedDate.join(" ");
};

export const browserRouter = createBrowserRouter();
