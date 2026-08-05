import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reports = vi.hoisted(() => ({
  campaignReportCsv: vi.fn(() => "date,clicks"),
  getSharedAdCampaignReport: vi.fn(),
}));
vi.mock("~/lib/admin/adCampaigns", () => reports);

import { createAdReportRouter } from "../../server/controllers/static/adReports";

describe("advertiser report host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REPORT_BASE_URL = "https://reports.santosa.family";
  });

  it("serves an analytics-free no-store shell only on the report host", async () => {
    const app = express().use(createAdReportRouter());
    const response = await request(app)
      .get("/")
      .set("Host", "reports.santosa.family")
      .expect(200);

    expect(response.text).toContain("Ferry FYI campaign report");
    expect(response.text).not.toMatch(/google|sentry|dataLayer/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toContain("noindex");

    await request(app).get("/").set("Host", "ferry.fyi").expect(404);
  });

  it("exchanges a body secret for one campaign-scoped aggregate report", async () => {
    reports.getSharedAdCampaignReport.mockResolvedValue({
      campaign: { reportName: "Coffee launch" },
      daily: [],
      methodology: "Aggregate only",
      totals: {},
    });
    const app = express().use(createAdReportRouter());

    const response = await request(app)
      .post("/report-data")
      .set("Host", "reports.santosa.family")
      .send({ token: "adr_secret" })
      .expect(200);

    expect(response.body.campaign.reportName).toBe("Coffee launch");
    expect(reports.getSharedAdCampaignReport).toHaveBeenCalledWith(
      "adr_secret"
    );
  });

  it("blocks ordinary app paths on the report host", async () => {
    await request(express().use(createAdReportRouter()))
      .get("/schedule/3/7")
      .set("Host", "reports.santosa.family")
      .expect(404);
  });

  it("rejects a report origin that would replace the normal app", () => {
    const originalBaseUrl = process.env.BASE_URL;
    try {
      process.env.BASE_URL = "https://reports.santosa.family";
      expect(() => createAdReportRouter()).toThrow("dedicated origin");
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.BASE_URL;
      } else {
        process.env.BASE_URL = originalBaseUrl;
      }
    }
  });
});
