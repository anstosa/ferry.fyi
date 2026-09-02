import express from "express";
import { JSDOM } from "jsdom";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reports = vi.hoisted(() => ({
  campaignReportCsv: vi.fn(() => "date,clicks"),
  getSharedAdCampaignReport: vi.fn(),
}));
vi.mock("~/lib/admin/adCampaigns", () => reports);

import {
  createAdReportRouter,
  createLegacyAdReportRedirectRouter,
} from "../../server/controllers/static/adReports";

// mount the production report path
const reportApp = (): express.Express =>
  express().use("/ad-reports", createAdReportRouter());

describe("same-origin advertiser reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves a branded analytics-free no-store shell", async () => {
    const response = await request(reportApp()).get("/ad-reports/").expect(200);

    expect(response.text).toContain("Ferry FYI campaign report");
    expect(response.text).toContain("/static/images/ferry-fyi-logo.png");
    expect(response.text).toContain("/ad-reports/report.css");
    expect(response.text).not.toMatch(/google|sentry|dataLayer/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "style-src 'self'"
    );
    expect(response.headers["x-robots-tag"]).toContain("noindex");
  });

  it("serves app-styled report assets from the same path", async () => {
    const app = reportApp();
    const css = await request(app).get("/ad-reports/report.css").expect(200);
    const script = await request(app).get("/ad-reports/report.js").expect(200);

    expect(css.text).toContain("linear-gradient(135deg, #016f52");
    expect(css.headers["content-type"]).toContain("text/css");
    expect(script.text).toContain("/ad-reports/report-data");
    expect(script.headers["content-type"]).toContain("javascript");
  });

  // exercise advertiser report behavior
  it("renders campaign context and downloads the collapsed report", async () => {
    const app = reportApp();
    const shell = await request(app).get("/ad-reports/").expect(200);
    const script = await request(app).get("/ad-reports/report.js").expect(200);
    const dom = new JSDOM(shell.text, {
      runScripts: "outside-only",
      url: "https://ferry.fyi/ad-reports/#adr_secret",
    });
    const report = {
      campaign: {
        advertiserName: "Island Coffee",
        endedEarlyAt: "2026-08-29T19:30:00.000Z",
        endsAt: "2026-09-01T07:00:00.000Z",
        reportName: "Coffee launch",
        startsAt: "2026-08-01T07:00:00.000Z",
      },
      daily: [
        {
          businessDate: "2026-08-01",
          clickCount: "7",
          opportunityCount: "123",
          servedCount: "229",
          viewableCount: "183",
        },
      ],
      methodology: "Aggregate only",
      totals: {
        clickCount: "7",
        clickThroughRate: "3.06%",
        opportunityCount: "123",
        servedCount: "229",
        viewableClickThroughRate: "3.83%",
        viewabilityRate: "79.91%",
        viewableCount: "183",
      },
    };
    // serve report data and exports
    const fetch = vi.fn((path: string) => {
      // report data response
      if (path === "/ad-reports/report-data") {
        return Promise.resolve({
          json: () => Promise.resolve(report),
          ok: true,
        });
      }
      return Promise.resolve({
        blob: () => Promise.resolve(new dom.window.Blob(["date,clicks"])),
        ok: true,
      });
    });
    const createObjectUrl = vi.fn(() => "blob:report");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(dom.window, "fetch", { value: fetch });
    Object.defineProperty(dom.window.URL, "createObjectURL", {
      value: createObjectUrl,
    });
    Object.defineProperty(dom.window.URL, "revokeObjectURL", {
      value: revokeObjectUrl,
    });

    dom.window.eval(script.text);

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector("#report")?.hidden).toBe(false);
    });
    expect(dom.window.location.hash).toBe("");
    expect(
      dom.window.document.querySelector("#campaign-start")?.textContent
    ).toBe("Aug 1, 2026 · 12:00 AM");
    expect(
      dom.window.document.querySelector("#campaign-stop")?.textContent
    ).toBe("Aug 29, 2026 · 12:30 PM");
    expect(
      dom.window.document.querySelector(
        'summary[aria-label="About Click-through rate"]'
      )?.parentElement?.textContent
    ).toContain("viewable CTR is 3.83%");
    expect(
      dom.window.document.querySelector(".metric-benchmark")?.textContent
    ).toBe("Typical display ads: 0.46%");
    expect(
      dom.window.document
        .querySelector("details.daily-details")
        ?.hasAttribute("open")
    ).toBe(false);
    expect(dom.window.document.querySelector("#daily")?.textContent).toContain(
      "2026-08-011232291837"
    );

    dom.window.document.querySelector<HTMLButtonElement>("#download")?.click();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/ad-reports/report-export",
        expect.objectContaining({
          body: JSON.stringify({ token: "adr_secret" }),
        })
      );
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
    });
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:report");
    dom.window.close();
  });

  it("exchanges a body secret for one campaign-scoped aggregate report", async () => {
    reports.getSharedAdCampaignReport.mockResolvedValue({
      campaign: {
        advertiserName: "Island Coffee",
        reportName: "Coffee launch",
      },
      daily: [],
      methodology: "Aggregate only",
      totals: {},
    });

    const response = await request(reportApp())
      .post("/ad-reports/report-data")
      .send({ token: "adr_secret" })
      .expect(200);

    expect(response.body.campaign.reportName).toBe("Coffee launch");
    expect(reports.getSharedAdCampaignReport).toHaveBeenCalledWith(
      "adr_secret"
    );
  });

  it("does not claim ordinary app paths", async () => {
    await request(reportApp()).get("/schedule/3/7").expect(404);
  });

  it("moves previously issued links to the canonical report path", async () => {
    const app = express()
      .use(createLegacyAdReportRedirectRouter())
      .use((_request, response) => response.sendStatus(404));
    const shell = await request(app)
      .get("/")
      .set("Host", "reports.santosa.family")
      .expect(200);
    const script = await request(app)
      .get("/legacy-ad-report-redirect.js")
      .set("Host", "reports.santosa.family")
      .expect(200);

    expect(shell.text).toContain("/legacy-ad-report-redirect.js");
    expect(shell.headers["cache-control"]).toBe("no-store");
    expect(script.text).toContain(
      'new URL("/ad-reports/", "https://ferry.fyi")'
    );
    expect(script.text).toContain("target.hash = location.hash");
    await request(app).get("/").set("Host", "ferry.fyi").expect(404);
  });
});
