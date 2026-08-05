import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
const campaigns = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
}));
const campaignMetrics = vi.hoisted(() => ({ findAll: vi.fn() }));
const placements = vi.hoisted(() => ({ findByPk: vi.fn() }));
const placementMetrics = vi.hoisted(() => ({ findAll: vi.fn() }));
const shares = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ db: database }));
vi.mock("~/models/AdCampaign", () => ({ AdCampaign: campaigns }));
vi.mock("~/models/AdCampaignDailyMetric", () => ({
  AdCampaignDailyMetric: campaignMetrics,
}));
vi.mock("~/models/AdPlacement", () => ({ AdPlacement: placements }));
vi.mock("~/models/AdPlacementDailyMetric", () => ({
  AdPlacementDailyMetric: placementMetrics,
}));
vi.mock("~/models/AdReportShare", () => ({ AdReportShare: shares }));

import {
  getAdCampaignReport,
  scheduleAdCampaign,
} from "../../../server/lib/admin/adCampaigns";

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const placement = {
  advertiserName: "Island Coffee",
  arrivalTerminalId: "7",
  body: "Open early",
  departureTerminalId: "3",
  headline: "Coffee near the terminal",
  key: "schedule--3--7",
  slot: "schedule",
  targetUrl: "https://example.com/menu",
};

describe("admin ad campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.transaction.mockImplementation(
      async (callback) => await callback(transaction)
    );
    database.query.mockResolvedValue([]);
  });

  it("locks the placement and snapshots normalized creative into a campaign", async () => {
    placements.findByPk.mockResolvedValue(placement);
    campaigns.create.mockImplementation(async (value) => ({
      ...value,
      endedEarlyAt: null,
    }));

    const result = await scheduleAdCampaign({
      endsAt: "2026-09-01T07:00:00.000Z",
      placementKey: placement.key,
      reportName: " September sponsor ",
      startsAt: "2026-08-05T07:00:00.000Z",
    });

    expect(placements.findByPk).toHaveBeenCalledWith(
      placement.key,
      expect.objectContaining({ lock: "UPDATE", transaction })
    );
    expect(campaigns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        advertiserName: "Island Coffee",
        placementKey: placement.key,
        reportName: "September sponsor",
        targetUrl: "https://example.com/menu",
      }),
      { transaction }
    );
    expect(result.reportName).toBe("September sponsor");
  });

  it("derives exact string totals and rates from daily aggregates", async () => {
    campaigns.findByPk.mockResolvedValue({
      ...placement,
      endedEarlyAt: null,
      endsAt: new Date("2026-09-01T07:00:00.000Z"),
      id: "campaign",
      placementKey: placement.key,
      reportName: "September sponsor",
      startsAt: new Date("2026-08-05T07:00:00.000Z"),
    });
    campaignMetrics.findAll.mockResolvedValue([
      {
        businessDate: "2026-08-05",
        clickCount: "2",
        opportunityCount: "20",
        servedCount: "10",
        viewableCount: "5",
      },
    ]);

    const report = await getAdCampaignReport("campaign");

    expect(report.totals).toEqual({
      clickCount: "2",
      clickThroughRate: "40.00%",
      opportunityCount: "20",
      servedCount: "10",
      viewabilityRate: "50.00%",
      viewableCount: "5",
    });
  });
});
