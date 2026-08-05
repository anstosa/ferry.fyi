import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ads = vi.hoisted(() => ({
  getAdminAds: vi.fn(),
  saveAdPlacement: vi.fn(),
  setAdsEnabled: vi.fn(),
}));
vi.mock("~/lib/admin/ads", () => ads);
const campaigns = vi.hoisted(() => ({
  scheduleAdCampaign: vi.fn(),
}));
vi.mock("~/lib/admin/adCampaigns", () => campaigns);

import { adminAdsRouter } from "../../../server/controllers/api/admin/ads";
import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";

const configuration = { adsEnabled: true, placements: [] };
const app = (): express.Express => {
  const value = express();
  value.use(express.json());
  value.use("/ads", adminAdsRouter);
  return value;
};

const confirmed = (target: string) => ({
  action: "save-ad-settings",
  confirmation: getAdminConfirmationPhrase("save-ad-settings", target),
  target,
});

describe("admin ad routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ads.getAdminAds.mockResolvedValue(configuration);
    ads.saveAdPlacement.mockResolvedValue(configuration);
    ads.setAdsEnabled.mockResolvedValue(configuration);
    campaigns.scheduleAdCampaign.mockResolvedValue({ id: "campaign" });
  });

  it("binds campaign scheduling to the selected directional placement", async () => {
    const placementKey = "schedule--3--7";
    const target = `ad-campaign:${placementKey}`;
    const action = "schedule-ad-campaign" as const;
    const body = {
      action,
      confirmation: getAdminConfirmationPhrase(action, target),
      endsAt: "2026-09-01T07:00:00.000Z",
      placementKey,
      reportName: "September sponsor",
      startsAt: "2026-08-05T07:00:00.000Z",
      target,
    };

    await request(app()).post("/ads/campaigns").send(body).expect(201);
    expect(campaigns.scheduleAdCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ placementKey, reportName: body.reportName })
    );

    await request(app())
      .post("/ads/campaigns")
      .send({ ...body, confirmation: "wrong" })
      .expect(400);
  });

  it("gets all ad settings and requires the global confirmation target", async () => {
    await request(app()).get("/ads").expect(200, configuration);
    await request(app())
      .put("/ads/global")
      .send({ adsEnabled: true })
      .expect(400);
    await request(app())
      .put("/ads/global")
      .send({ adsEnabled: true, ...confirmed("ads:global") })
      .expect(200, configuration);
    expect(ads.setAdsEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ adsEnabled: true })
    );
  });

  it("binds placement saves to the safe route key and returns the full configuration", async () => {
    const key = "schedule--3--7";
    const target = `ad:${key}`;
    const body = {
      advertiserName: "Island Coffee",
      arrivalTerminalId: "7",
      departureTerminalId: "3",
      enabled: true,
      headline: "Coffee nearby",
      key,
      slot: "schedule",
      targetUrl: "https://example.com/menu",
    };
    await request(app())
      .put(`/ads/placements/${key}`)
      .send({ ...body, ...confirmed(target) })
      .expect(200, configuration);
    expect(ads.saveAdPlacement).toHaveBeenCalledWith(
      key,
      expect.objectContaining(body)
    );

    await request(app())
      .put("/ads/placements/schedule%2Funsafe")
      .send({ ...body, ...confirmed("ad:schedule/unsafe") })
      .expect(400);
    await request(app())
      .put("/ads/placements/schedule")
      .send({ ...body, ...confirmed("ad:schedule") })
      .expect(400);
  });
});
