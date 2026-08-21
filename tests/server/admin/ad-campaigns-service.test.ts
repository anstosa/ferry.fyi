import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
const campaigns = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
}));
const campaignMetrics = vi.hoisted(() => ({ findAll: vi.fn() }));
const placements = vi.hoisted(() => ({ findAll: vi.fn(), findByPk: vi.fn() }));
const placementMetrics = vi.hoisted(() => ({ findAll: vi.fn() }));
const placementHourlyMetrics = vi.hoisted(() => ({ findAll: vi.fn() }));
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
vi.mock("~/models/AdPlacementHourlyMetric", () => ({
  AdPlacementHourlyMetric: placementHourlyMetrics,
}));
vi.mock("~/models/AdReportShare", () => ({ AdReportShare: shares }));

import {
  getAdCampaignReport,
  getAdInventoryReport,
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
    placements.findAll.mockResolvedValue([]);
    placementMetrics.findAll.mockResolvedValue([]);
    placementHourlyMetrics.findAll.mockResolvedValue([]);
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

  it("aggregates placements and fills weekday and hour drill-down buckets", async () => {
    placements.findAll.mockResolvedValue([
      { key: "cameras--3--7" },
      { key: "home" },
      { key: "schedule--3--7" },
    ]);
    placementMetrics.findAll.mockResolvedValue([
      {
        businessDate: "2026-08-03",
        opportunityCount: "10",
        placementKey: "schedule--3--7",
      },
      {
        businessDate: "2026-08-04",
        opportunityCount: "5",
        placementKey: "home",
      },
      {
        businessDate: "2026-08-10",
        opportunityCount: "20",
        placementKey: "schedule--3--7",
      },
    ]);
    placementHourlyMetrics.findAll.mockResolvedValue([
      {
        businessDate: "2026-08-05",
        businessHour: 8,
        opportunityCount: "12",
      },
      {
        businessDate: "2026-08-06",
        businessHour: 17,
        opportunityCount: "18",
      },
    ]);

    const report = await getAdInventoryReport({
      endDate: "2026-08-10",
      placementKey: "schedule--3--7",
      startDate: "2026-08-03",
    });

    expect(report.placements).toEqual([
      { opportunityCount: "30", placementKey: "schedule--3--7" },
      { opportunityCount: "5", placementKey: "home" },
      { opportunityCount: "0", placementKey: "cameras--3--7" },
    ]);
    expect(report.selectedPlacement).toMatchObject({
      hourlyDataStartDate: "2026-08-05",
      opportunityCount: "30",
      placementKey: "schedule--3--7",
    });
    expect(report.selectedPlacement?.weekday[0]).toEqual({
      opportunityCount: "30",
      weekday: 1,
    });
    expect(report.selectedPlacement?.hourOfDay[8]).toEqual({
      hour: 8,
      opportunityCount: "12",
    });
    expect(report.selectedPlacement?.hourOfDay[17]).toEqual({
      hour: 17,
      opportunityCount: "18",
    });
  });

  it("drills into measured historical placement keys", async () => {
    placementMetrics.findAll.mockResolvedValue([
      {
        businessDate: "2026-08-03",
        opportunityCount: "7",
        placementKey: "retired-placement",
      },
    ]);
    placementHourlyMetrics.findAll.mockResolvedValue([
      {
        businessDate: "2026-08-03",
        businessHour: 9,
        opportunityCount: "7",
      },
    ]);

    const report = await getAdInventoryReport({
      endDate: "2026-08-03",
      placementKey: "retired-placement",
      startDate: "2026-08-03",
    });

    expect(report.selectedPlacement).toMatchObject({
      opportunityCount: "7",
      placementKey: "retired-placement",
    });
    expect(report.selectedPlacement?.hourOfDay[9].opportunityCount).toBe("7");
  });
});
