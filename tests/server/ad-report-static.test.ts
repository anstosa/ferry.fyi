import express from "express";
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
    expect(css.text).toContain(".metric-tooltip");
    expect(css.text).toContain(".daily-details");
    expect(css.text).toContain(".download-button");
    expect(css.text).toContain("background: transparent");
    expect(css.headers["content-type"]).toContain("text/css");
    expect(script.text).toContain("/ad-reports/report-data");
    expect(script.text).toContain(
      'helpIcon.src = "/static/images/icons/solid/info-circle.svg"'
    );
    expect(script.text).toContain("report.campaign.startsAt");
    expect(script.text).toContain(
      "report.campaign.endedEarlyAt ?? report.campaign.endsAt"
    );
    expect(script.text).toContain('" · "');
    expect(script.text).not.toContain("timeZoneName");
    expect(script.text).toContain('"Typical display ads: "');
    expect(script.text).toContain('const DISPLAY_CTR_BASELINE = "0.46%"');
    expect(script.text).toContain("report.totals.viewableClickThroughRate");
    expect(script.text).not.toContain('getElementById("methodology")');
    expect(script.headers["content-type"]).toContain("javascript");
  });

  // verify collapsed daily details
  it("collapses daily performance and moves methodology into stat help", async () => {
    const response = await request(reportApp()).get("/ad-reports/").expect(200);

    expect(response.text).toContain('<details class="daily-details">');
    expect(response.text).not.toContain('<details class="daily-details" open');
    expect(response.text).not.toContain('id="methodology"');
    expect(response.text).toContain('id="campaign-start"');
    expect(response.text).toContain('id="campaign-stop"');
    expect(response.text).toContain('class="download-button"');
    expect(response.text.indexOf('class="daily-details"')).toBeLessThan(
      response.text.indexOf('id="download"')
    );
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
