import { Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

export const adminAdsRouter = Router();
const safeIdPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const safePlacementKeyPattern =
  /^(?:home|(?:schedule|cameras|terminal|fare)--[A-Za-z0-9_][A-Za-z0-9_-]*--[A-Za-z0-9_][A-Za-z0-9_-]*)$/;

adminAdsRouter.get("/", async (_request, response) => {
  const { getAdminAds } = await import("~/lib/admin/ads");
  response.send(await getAdminAds());
});

adminAdsRouter.put(
  "/global",
  requireTypedConfirmation({
    action: "save-ad-settings",
    getTarget: () => "ads:global",
  }),
  async (request, response) => {
    try {
      const { setAdsEnabled } = await import("~/lib/admin/ads");
      response.send(await setAdsEnabled(request.body));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid ad settings",
      });
    }
  }
);

adminAdsRouter.get("/campaigns", async (request, response) => {
  const { listAdCampaigns } = await import("~/lib/admin/adCampaigns");
  response.send(
    await listAdCampaigns(
      typeof request.query.placementKey === "string"
        ? request.query.placementKey
        : undefined
    )
  );
});

adminAdsRouter.post(
  "/campaigns",
  requireTypedConfirmation({
    action: "schedule-ad-campaign",
    getTarget: (request) =>
      typeof request.body?.placementKey === "string" &&
      safePlacementKeyPattern.test(request.body.placementKey)
        ? `ad-campaign:${request.body.placementKey}`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { scheduleAdCampaign } = await import("~/lib/admin/adCampaigns");
      response.status(201).send(await scheduleAdCampaign(request.body));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid ad campaign",
      });
    }
  }
);

adminAdsRouter.post(
  "/campaigns/:id/end",
  requireTypedConfirmation({
    action: "end-ad-campaign",
    getTarget: (request) =>
      safeIdPattern.test(request.params.id)
        ? `ad-campaign:${request.params.id}:end`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { endAdCampaign } = await import("~/lib/admin/adCampaigns");
      response.send(await endAdCampaign(request.params.id));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid ad campaign",
      });
    }
  }
);

adminAdsRouter.get("/reports/inventory", async (request, response) => {
  try {
    const { getAdInventoryReport } = await import("~/lib/admin/adCampaigns");
    response.send(
      await getAdInventoryReport({
        endDate: request.query.endDate,
        placementKey: request.query.placementKey,
        startDate: request.query.startDate,
      })
    );
  } catch (error) {
    response.status(400).send({
      error: error instanceof Error ? error.message : "Invalid report range",
    });
  }
});

adminAdsRouter.get("/reports/campaigns/:id.csv", async (request, response) => {
  const { campaignReportCsv, getAdCampaignReport } =
    await import("~/lib/admin/adCampaigns");
  const report = await getAdCampaignReport(request.params.id);
  response
    .type("text/csv")
    .attachment(`ad-campaign-${request.params.id}.csv`)
    .send(campaignReportCsv(report));
});

adminAdsRouter.get("/reports/campaigns/:id", async (request, response) => {
  const { getAdCampaignReport } = await import("~/lib/admin/adCampaigns");
  response.send(await getAdCampaignReport(request.params.id));
});

adminAdsRouter.get("/campaigns/:id/shares", async (request, response) => {
  const { listAdReportShares } = await import("~/lib/admin/adCampaigns");
  response.send(await listAdReportShares(request.params.id));
});

adminAdsRouter.post(
  "/campaigns/:id/shares",
  requireTypedConfirmation({
    action: "create-ad-report-share",
    getTarget: (request) =>
      safeIdPattern.test(request.params.id)
        ? `ad-campaign:${request.params.id}:share`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { createAdReportShare } = await import("~/lib/admin/adCampaigns");
      response.status(201).send(await createAdReportShare(request.params.id));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid report share",
      });
    }
  }
);

adminAdsRouter.post(
  "/shares/:id/revoke",
  requireTypedConfirmation({
    action: "revoke-ad-report-share",
    getTarget: (request) =>
      safeIdPattern.test(request.params.id)
        ? `ad-report-share:${request.params.id}`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { revokeAdReportShare } = await import("~/lib/admin/adCampaigns");
      response.send(await revokeAdReportShare(request.params.id));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid report share",
      });
    }
  }
);

adminAdsRouter.put(
  "/placements/:key",
  requireTypedConfirmation({
    action: "save-ad-settings",
    getTarget: (request) =>
      safePlacementKeyPattern.test(request.params.key)
        ? `ad:${request.params.key}`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { saveAdPlacement } = await import("~/lib/admin/ads");
      response.send(await saveAdPlacement(request.params.key, request.body));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid ad placement",
      });
    }
  }
);
