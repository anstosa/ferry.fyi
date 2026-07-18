import express from "express";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStaticRouter } from "../../server/controllers/static";
import {
  createBrowserRouter,
  renderSeoHtml,
} from "../../server/controllers/static/browser";
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
  app = express();
  app.use(createBrowserRouter(clientDist));
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
  it("creates indexable canonical schedule metadata", () => {
    const metadata = getRouteSeoMetadata(seattle, bainbridge, "schedule");

    expect(metadata).toMatchObject({
      canonicalPath: "/seattle",
      robots: "index,follow",
      title: "Seattle to Bainbridge Island Ferry Schedule - Ferry FYI",
    });
    expect(metadata.description).toContain(
      "Washington State Ferries schedules"
    );
  });

  it("noindexes dated and route-adjacent variants", () => {
    expect(
      getRouteSeoMetadata(seattle, bainbridge, "schedule", true).robots
    ).toBe("noindex,follow");
    expect(getRouteSeoMetadata(seattle, bainbridge, "cameras").robots).toBe(
      "noindex,follow"
    );
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
    expect(
      getTerminalSeoMetadata({ name: "Seattle", slug: "seattle" })
    ).toMatchObject({
      canonicalPath: "/seattle/terminal",
      robots: "index,follow",
    });
  });

  it("keeps product pages indexable and private pages noindexed", () => {
    expect(getSeoMetadata("/forecasting").robots).toBe("index,follow");
    expect(getSeoMetadata("/account").robots).toBe("noindex,follow");
    expect(getSeoUrl("https://ferry.fyi/", "/about")).toBe(
      "https://ferry.fyi/about"
    );
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
      aliases: [],
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

    for (const [pathname, canonicalPath] of [
      ["/seattle/fare", "/seattle/bainbridge-island/fare"],
      ["/seattle/bremerton/fare", "/seattle/bremerton/fare"],
    ]) {
      const fareResponse = await request(app).get(pathname).expect(200);

      expect(fareResponse.text).toContain("fare - Ferry FYI");
      expect(fareResponse.text).toContain(
        `rel="canonical" href="https://ferry.fyi${canonicalPath}"`
      );
      expect(fareResponse.text).toContain('content="noindex,follow"');
    }
  });

  it("noindexes routes whose mate does not belong to the terminal", async () => {
    const response = await request(app)
      .get("/bainbridge-island/bremerton")
      .expect(200);

    expect(response.text).toContain('content="noindex,follow"');
    expect(response.text).not.toContain(
      "Seattle to Bainbridge Island Ferry Schedule"
    );
  });

  it("noindexes malformed nested route URLs", async () => {
    for (const pathname of [
      "/seattle/not-a-mate/terminal",
      "/seattle/bremerton/terminal",
      "/seattle/bremerton/schedule",
    ]) {
      const response = await request(app).get(pathname).expect(200);

      expect(response.text).toContain('content="noindex,follow"');
      expect(response.text).not.toContain(
        "Seattle Ferry Terminal Information - Ferry FYI"
      );
      expect(response.text).not.toContain(
        "Seattle to Bremerton Ferry Schedule - Ferry FYI"
      );
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

  it("renders noindex metadata for dated and route-adjacent pages", async () => {
    vi.useFakeTimers();
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
      "/today",
    ]) {
      const response = await request(app).get(pathname).expect(200);

      expect(response.text).toContain('content="noindex,follow"');
    }
  });
});
