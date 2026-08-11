import express from "express";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStaticPolicyRateLimiter,
  createStaticPolicyRouter,
  createStaticRouter,
} from "../../server/controllers/static";
import {
  createBrowserRateLimiter,
  createBrowserRouter,
  getInternalRedirectPath,
  getRuntimeReleaseVersion,
  renderSeoHtml,
} from "../../server/controllers/static/browser";
import * as leaderboardFlags from "../../server/lib/leaderboardFlags";
import { Terminal } from "../../server/models/Terminal";
import {
  getHowManyBoatsSeoMetadata,
  getRouteSeoMetadata,
  getSeoMetadata,
  getSeoProfile,
  getSeoUrl,
  getTerminalSeoMetadata,
  SEO_HOW_MANY_BOATS_BASE_URL,
  SEO_HOW_MANY_BOATS_HOST,
  SEO_INDEXABLE_PATHS,
  SEO_INDEXABLE_ROUTE_VIEWS,
} from "../../shared/lib/seo";

const bainbridge = {
  name: "Bainbridge Island",
  slug: "bainbridge-island",
  mates: [] as (typeof seattle)[],
};
const seattle = {
  name: "Seattle",
  slug: "seattle",
  mates: [bainbridge],
};
bainbridge.mates = [seattle];

const template = readFileSync(path.resolve("client/index.html"), "utf-8");

let clientDist: string;
let app: express.Express;
let originalBaseUrl: string | undefined;

beforeEach(() => {
  originalBaseUrl = process.env.BASE_URL;
  clientDist = mkdtempSync(path.join(tmpdir(), "ferry-seo-"));
  writeFileSync(path.join(clientDist, "index.html"), template);
  copyFileSync("client/static/llms.txt", path.join(clientDist, "llms.txt"));
  copyFileSync("client/static/robots.txt", path.join(clientDist, "robots.txt"));
  app = express();
  app.use(createStaticRouter(clientDist));
});

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.BASE_URL;
  } else {
    process.env.BASE_URL = originalBaseUrl;
  }
  vi.useRealTimers();
  rmSync(clientDist, { force: true, recursive: true });
});

describe("SEO metadata", () => {
  it("injects the running release version into browser HTML", () => {
    expect(
      getRuntimeReleaseVersion({
        HEROKU_RELEASE_VERSION: "runtime-hash",
        NODE_ENV: "production",
      })
    ).toBe("runtime-hash");

    const html = renderSeoHtml(
      template.replace("%APP_RELEASE_VERSION%", "build-hash"),
      getSeoMetadata("/about"),
      "https://ferry.fyi",
      undefined,
      "runtime-hash"
    );

    expect(html).toContain(
      '<meta name="ferry-fyi-release" content="runtime-hash" />'
    );
  });

  it("keeps the build release when runtime metadata is unavailable", () => {
    const html = renderSeoHtml(
      template.replace("%APP_RELEASE_VERSION%", "build-hash"),
      getSeoMetadata("/about"),
      "https://ferry.fyi",
      undefined,
      ""
    );

    expect(html).toContain(
      '<meta name="ferry-fyi-release" content="build-hash" />'
    );
  });

  it("rate limits browser endpoints", async () => {
    const rateLimitedApp = express();
    rateLimitedApp.use(createBrowserRateLimiter({ limit: 1 }));
    rateLimitedApp.use(createBrowserRouter(clientDist));

    await request(rateLimitedApp).get("/about").expect(200);
    await request(rateLimitedApp).get("/privacy").expect(429);
  });

  it("rate limits discovery documents independently", async () => {
    const rateLimitedApp = express();
    rateLimitedApp.use(
      createStaticPolicyRouter(clientDist, {
        policyRateLimiter: createStaticPolicyRateLimiter({ limit: 1 }),
      })
    );

    await request(rateLimitedApp).get("/robots.txt").expect(200);
    const limited = await request(rateLimitedApp).get("/llms.txt").expect(429);
    expect(limited.headers.ratelimit).toBeDefined();
  });

  it("allows only same-origin canonical redirect paths", () => {
    expect(getInternalRedirectPath("/seattle/bainbridge")).toBe(
      "/seattle/bainbridge"
    );
    expect(
      getInternalRedirectPath("//untrusted.example/redirect")
    ).toBeUndefined();
    expect(
      getInternalRedirectPath("https://untrusted.example/redirect")
    ).toBeUndefined();
  });

  it("explicitly allows search and AI crawlers", async () => {
    const response = await request(app).get("/robots.txt").expect(200);

    expect(response.type).toBe("text/plain");
    expect(response.text).toContain("User-agent: Googlebot\nAllow: /");
    expect(response.text).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(response.text).toContain("User-agent: ClaudeBot\nAllow: /");
    expect(response.text).toContain("User-agent: PerplexityBot\nAllow: /");
    expect(response.text).toContain("Sitemap: https://ferry.fyi/sitemap.xml");
  });

  it("serves a concise app guide for language models", async () => {
    const response = await request(app).get("/llms.txt").expect(200);

    expect(response.type).toBe("text/plain");
    expect(response.text).toContain("# Ferry FYI");
    expect(response.text).toContain("## AI API guide");
    expect(response.text).toContain(
      "[Forecasting](https://ferry.fyi/forecasting)"
    );
    expect(response.text).toContain("GET /api/terminals");
    expect(response.text).toContain(
      "### Forecasts, delays, and service changes"
    );
    expect(response.text).not.toContain("wsdot.wa.gov");
  });

  it("makes the data sources and API guide a canonical public page", async () => {
    const response = await request(app).get("/data-sources").expect(200);

    expect(response.text).toContain("Ferry FYI Data Sources and API Guide");
    expect(response.text).toContain(
      'rel="canonical" href="https://ferry.fyi/data-sources"'
    );
    expect(response.text).toContain("How to cite Ferry FYI");
    expect(response.text).toContain('"@type":"Dataset"');
  });

  it("creates indexable canonical schedule metadata", () => {
    const metadata = getRouteSeoMetadata(seattle, bainbridge, "schedule");

    expect(metadata).toMatchObject({
      canonicalPath: "/seattle",
      robots: "index,follow",
      title: "Seattle to Bainbridge Island Ferry Schedule - Ferry FYI",
    });
    expect(metadata.description).toContain(
      "Washington State Ferries sailing times"
    );
  });

  it("indexes canonical route tabs and noindexes dated schedule variants", () => {
    expect(
      getRouteSeoMetadata(seattle, bainbridge, "schedule", true).robots
    ).toBe("noindex,follow");
    SEO_INDEXABLE_ROUTE_VIEWS.forEach((view) => {
      expect(getRouteSeoMetadata(seattle, bainbridge, view).robots).toBe(
        "index,follow"
      );
    });
    expect(getRouteSeoMetadata(seattle, bainbridge, "cameras")).toMatchObject({
      description:
        "View traffic camera images, source update times, and freshness details for the Seattle to Bainbridge Island Washington State Ferries route before traveling.",
      robots: "index,follow",
      title: "Seattle to Bainbridge Island Ferry Cameras - Ferry FYI",
    });
  });

  it("creates howmanyboats host metadata for server/client parity", () => {
    expect(getHowManyBoatsSeoMetadata()).toMatchObject({
      canonicalPath: "/",
      robots: "index,follow",
      title: "How Many Boats? - Ferry FYI",
    });
    expect(getSeoUrl(SEO_HOW_MANY_BOATS_BASE_URL, "/")).toBe(
      SEO_HOW_MANY_BOATS_BASE_URL
    );
    expect(getSeoProfile(SEO_HOW_MANY_BOATS_HOST, "/today")).toMatchObject({
      baseUrl: SEO_HOW_MANY_BOATS_BASE_URL,
      metadata: { canonicalPath: "/", robots: "index,follow" },
    });
    expect(getSeoProfile("ferry.fyi", "/today")).toMatchObject({
      metadata: { canonicalPath: "/today", robots: "noindex,follow" },
    });
  });

  it("creates terminal-owned metadata without a mate dependency", () => {
    const metadata = getTerminalSeoMetadata({
      name: "Seattle",
      slug: "seattle",
    });
    expect(metadata).toMatchObject({
      canonicalPath: "/seattle/terminal",
      robots: "index,follow",
    });
    expect(metadata.description).toContain("Seattle terminal");
  });

  it("keeps product pages indexable and private pages noindexed", () => {
    expect(getSeoMetadata("/forecasting").robots).toBe("index,follow");
    expect(getSeoMetadata("/data-sources").robots).toBe("index,follow");
    expect(getSeoMetadata("/tickets")).toMatchObject({
      robots: "index,follow",
      title: "Washington State Ferry Tickets & Barcode Scanner - Ferry FYI",
    });
    expect(getSeoMetadata("/privacy")).toMatchObject({
      robots: "index,follow",
      title: "Privacy Policy - Ferry FYI",
    });
    expect(getSeoMetadata("/feedback")).toMatchObject({
      robots: "index,follow",
      title: "Ferry FYI Support & Feedback",
    });
    expect(getSeoMetadata("/account").robots).toBe("noindex,follow");
    expect(getSeoMetadata("/login")).toMatchObject({
      robots: "noindex,follow",
      title: "Log In - Ferry FYI",
    });
    expect(getSeoMetadata("/logout")).toMatchObject({
      robots: "noindex,follow",
      title: "Log Out - Ferry FYI",
    });
    expect(getSeoUrl("https://ferry.fyi/", "/about")).toBe(
      "https://ferry.fyi/about"
    );
    const distinctProductDescriptions = [
      "/tickets",
      "/privacy",
      "/feedback",
    ].map((pathname) => getSeoMetadata(pathname).description);
    expect(new Set(distinctProductDescriptions).size).toBe(3);
    expect(distinctProductDescriptions[0]).toContain("tickets");
    expect(distinctProductDescriptions[1]).toContain("data");
    expect(distinctProductDescriptions[2]).toContain("support");
  });

  it("keeps every route description directional and purpose-specific", () => {
    const expectedPurpose = {
      alerts: "service bulletins",
      cameras: "camera images",
      fare: "fare options",
      map: "vessel locations",
      schedule: "sailing times",
      subscribe: "notifications",
    } as const;
    Object.entries(expectedPurpose).forEach(([view, purpose]) => {
      const metadata = getRouteSeoMetadata(
        seattle,
        bainbridge,
        view as keyof typeof expectedPurpose
      );
      expect(metadata.description).toContain("Seattle to Bainbridge Island");
      expect(metadata.description).toContain(purpose);
      expect(metadata.robots).toBe("index,follow");
    });
  });

  it("keeps the fixed sitemap policy represented by public route metadata", () => {
    SEO_INDEXABLE_PATHS.forEach((pathname) => {
      expect(getSeoMetadata(pathname)).toMatchObject({
        canonicalPath: pathname,
        robots: "index,follow",
      });
    });
  });

  it("renders canonical metadata for newly indexable product pages", async () => {
    for (const [pathname, title] of [
      [
        "/tickets",
        "Washington State Ferry Tickets & Barcode Scanner - Ferry FYI",
      ],
      ["/privacy", "Privacy Policy - Ferry FYI"],
      ["/feedback", "Ferry FYI Support & Feedback"],
    ]) {
      const response = await request(app).get(pathname).expect(200);

      expect(response.text).toContain(
        `<title data-seo-seed="true">${title.replaceAll("&", "&amp;")}</title>`
      );
      expect(response.text).toContain('content="index,follow"');
      expect(response.text).toContain(
        `rel="canonical" href="https://ferry.fyi${pathname}"`
      );
    }
  });

  it("renders hermetic absolute crawler metadata for the homepage", () => {
    const html = renderSeoHtml(
      template,
      getSeoMetadata("/"),
      "https://ferry.fyi"
    );

    expect(html).not.toContain("%APP_TITLE%");
    expect(html).not.toContain("%APP_DESCRIPTION%");
    expect(html).not.toContain("%SEO_BASE_URL%");
    expect(html).toContain('rel="canonical" href="https://ferry.fyi"');
    expect(html).toContain('property="og:url" content="https://ferry.fyi"');
    expect(html).toContain('"url":"https://ferry.fyi"');
    expect(html).toContain('<title data-seo-seed="true">');
    expect(html).toContain('data-seo-seed="true" name="robots"');
    expect(html).toContain('data-seo-seed="true" id="structured-data"');
    expect(html).toContain('id="seo-content"');
    expect(html).toContain(
      '<h1 id="seo-page-title">Ferry FYI - Washington State Ferries Schedules &amp; Tracker</h1>'
    );
    expect(html).toContain('"@type":"Organization"');
  });

  it("uses the second URL segment as the mate and third as the view", async () => {
    Terminal.purge();
    const bainbridge = new Terminal({
      aliases: [],
      id: "bainbridge",
      mates: [],
      name: "Bainbridge Island",
      slug: "bainbridge-island",
    });
    const bremerton = new Terminal({
      aliases: [],
      id: "bremerton",
      mates: [],
      name: "Bremerton",
      slug: "bremerton",
    });
    const seattle = new Terminal({
      aliases: ["sea"],
      id: "seattle",
      mates: [bainbridge, bremerton],
      name: "Seattle",
      slug: "seattle",
    });
    bainbridge.mates = [seattle];
    bremerton.mates = [seattle];
    seattle.save();
    bainbridge.save();
    bremerton.save();

    const response = await request(app).get("/seattle/terminal").expect(200);

    expect(response.text).toContain(
      "Seattle Ferry Terminal Information - Ferry FYI"
    );
    expect(response.text).toContain(
      'rel="canonical" href="https://ferry.fyi/seattle/terminal"'
    );

    process.env.BASE_URL = "https://ferry.fyi";
    const scheduleResponse = await request(app)
      .get("/seattle/bremerton")
      .expect(200);

    expect(scheduleResponse.text).toContain(
      "Seattle to Bremerton Ferry Schedule - Ferry FYI"
    );
    expect(scheduleResponse.text).toContain(
      'rel="canonical" href="https://ferry.fyi/seattle/bremerton"'
    );
    expect(scheduleResponse.text).toContain('content="index,follow"');
    expect(scheduleResponse.text).toContain(
      '<h1 id="seo-page-title">Seattle to Bremerton Ferry Schedule</h1>'
    );
    expect(scheduleResponse.text).not.toContain('"@type":"BreadcrumbList"');

    await request(app)
      .get("/seattle/fare")
      .expect(301)
      .expect("Location", "/seattle/bainbridge-island/fare");

    const fareResponse = await request(app)
      .get("/seattle/bremerton/fare")
      .expect(200);
    expect(fareResponse.text).toContain(
      "Seattle to Bremerton Ferry Fares - Ferry FYI"
    );
    expect(fareResponse.text).toContain(
      'rel="canonical" href="https://ferry.fyi/seattle/bremerton/fare"'
    );
    expect(fareResponse.text).toContain('content="index,follow"');

    for (const view of SEO_INDEXABLE_ROUTE_VIEWS) {
      const response = await request(app)
        .get(`/seattle/bremerton/${view}`)
        .expect(200);

      expect(response.text).toContain('content="index,follow"');
      expect(response.text).toContain(
        `rel="canonical" href="https://ferry.fyi/seattle/bremerton/${view}"`
      );
    }

    await request(app)
      .get("/sea/bremerton")
      .expect(301)
      .expect("Location", "/seattle/bremerton");
  });

  it("redirects the legacy forecasting explanation path", async () => {
    await request(app)
      .get("/forecasting-explained")
      .expect(301)
      .expect("Location", "/forecasting");
  });

  it.each(["/login", "/logout"])(
    "serves the private browser route %s",
    async (pathname) => {
      const response = await request(app).get(pathname).expect(200);
      expect(response.text).toContain('content="noindex,follow"');
    }
  );

  it("returns 404 for routes whose mate does not belong to the terminal", async () => {
    await request(app).get("/bainbridge-island/bremerton").expect(404);
  });

  it("returns 404 for malformed and unknown browser URLs", async () => {
    for (const pathname of [
      "/seattle/not-a-mate/terminal",
      "/seattle/bremerton/terminal",
      "/seattle/bremerton/schedule",
      "/not-a-real-page",
    ]) {
      await request(app).get(pathname).expect(404);
    }
  });

  it("renders consistent howmanyboats.today crawler metadata", async () => {
    const response = await request(app)
      .get("/")
      .set("Host", SEO_HOW_MANY_BOATS_HOST)
      .expect(200);

    expect(response.text).toContain("How Many Boats? - Ferry FYI");
    expect(response.text).toContain('content="index,follow"');
    expect(response.text).toContain(
      `rel="canonical" href="${SEO_HOW_MANY_BOATS_BASE_URL}"`
    );
    expect(response.text).toContain(
      `property="og:url" content="${SEO_HOW_MANY_BOATS_BASE_URL}"`
    );
    expect(response.text).toContain(`"url":"${SEO_HOW_MANY_BOATS_BASE_URL}"`);
    expect(response.text).not.toContain(
      "Washington State Ferries Schedules & Tracker"
    );
  });

  it("routes production document requests through SEO rendering before static fallback", async () => {
    process.env.BASE_URL = "https://ferry.fyi";
    const productionApp = express();
    productionApp.use(createStaticRouter(clientDist));

    for (const pathname of ["/", "/today", "/clinton"]) {
      const response = await request(productionApp)
        .get(pathname)
        .set("Host", SEO_HOW_MANY_BOATS_HOST)
        .expect(200);

      expect(response.text).toContain("How Many Boats? - Ferry FYI");
      expect(response.text).toContain(
        `rel="canonical" href="${SEO_HOW_MANY_BOATS_BASE_URL}"`
      );
      expect(response.text).not.toContain(
        'rel="canonical" href="https://ferry.fyi"'
      );
    }
  });

  it("renders noindex metadata only for dated schedule variants", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-14T12:00:00-07:00"));
    process.env.BASE_URL = "https://ferry.fyi";

    const datedResponse = await request(app)
      .get("/seattle/bremerton?date=2026-07-15")
      .expect(200);

    expect(datedResponse.text).toContain('content="noindex,follow"');
    expect(datedResponse.text).toContain(
      "Seattle to Bremerton Ferry Schedule on Wed 15 - Ferry FYI"
    );
    expect(datedResponse.text).toContain(
      'rel="canonical" href="https://ferry.fyi/seattle/bremerton"'
    );
    expect(datedResponse.text).toContain(
      'property="og:url" content="https://ferry.fyi/seattle/bremerton"'
    );
    expect(datedResponse.text).toContain(
      '"url":"https://ferry.fyi/seattle/bremerton"'
    );
    expect(datedResponse.text).not.toContain("date=2026-07-15");

    for (const pathname of [
      "/seattle/bremerton/cameras",
      "/seattle/bremerton/map",
    ]) {
      const response = await request(app).get(pathname).expect(200);

      expect(response.text).toContain('content="index,follow"');
    }
  });

  it("serves a noindex SPA shell for privately rolled-out leaderboard routes", async () => {
    vi.spyOn(leaderboardFlags, "isPublicFeatureEnabled").mockResolvedValue(
      false
    );
    const response = await request(app).get("/leaderboards").expect(200);

    expect(response.headers["x-robots-tag"]).toBe("noindex, follow");
    expect(response.text).toContain("Ferry FYI");
    expect(response.text).toContain('name="robots" content="noindex,follow"');
    vi.restoreAllMocks();
  });
});
