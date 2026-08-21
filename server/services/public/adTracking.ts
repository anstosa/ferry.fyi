import { createHash, randomBytes } from "crypto";
import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op, QueryTypes, Transaction } from "sequelize";
import {
  type AdCampaignCreative,
  type AdExposure,
  type AdMeasurementEvent,
  parseAdPlacementKey,
} from "shared/contracts/ads";

import { db } from "~/lib/db";
import { AdCampaign } from "~/models/AdCampaign";
import { AdMeasurementExposure } from "~/models/AdMeasurementExposure";
import { AdPlacement } from "~/models/AdPlacement";
import { SiteControl } from "~/models/SiteControl";

const EXPOSURE_PREFIX = "adx_";
const EXPOSURE_TTL_MS = 2 * 60 * 60 * 1000;
const SITE_CONTROL_KEY = "public";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ClaimEvent = AdMeasurementEvent | "click";

const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

const isMeasurementEnabled = (): boolean =>
  process.env.AD_MEASUREMENT_ENABLED !== "false";

const asCreative = (campaign: AdCampaign): AdCampaignCreative => ({
  advertiserName: campaign.advertiserName,
  body: campaign.body,
  campaignId: campaign.id,
  headline: campaign.headline,
  placementKey: campaign.placementKey,
  targetUrl: campaign.targetUrl,
});

const getSiteControl = async (): Promise<SiteControl> => {
  const [control] = await SiteControl.findOrCreate({
    defaults: {
      adsEnabled: false,
      crawlerPolicy: {},
      key: SITE_CONTROL_KEY,
      leaderboardIndexingEnabled: true,
      leaderboardSharingEnabled: true,
      maintenanceEnabled: false,
      maintenanceMessage: "",
    },
    where: { key: SITE_CONTROL_KEY },
  });
  return control;
};

const getOrCreatePlacement = async (key: string): Promise<AdPlacement> => {
  const parsed = parseAdPlacementKey(key);
  if (!parsed) {
    throw Object.assign(new Error("Invalid ad placement"), { status: 400 });
  }
  const [placement] = await AdPlacement.findOrCreate({
    defaults: {
      advertiserName: "",
      arrivalTerminalId: parsed.arrivalTerminalId,
      body: "",
      departureTerminalId: parsed.departureTerminalId,
      enabled: false,
      headline: "",
      key,
      slot: parsed.slot,
      targetUrl: "",
    },
    where: { key },
  });
  return placement;
};

const findScheduledCampaign = async (
  placementKey: string,
  now: Date
): Promise<AdCampaign | null> =>
  await AdCampaign.findOne({
    order: [["startsAt", "DESC"]],
    where: {
      endsAt: { [Op.gt]: now },
      placementKey,
      startsAt: { [Op.lte]: now },
      [Op.or]: [{ endedEarlyAt: null }, { endedEarlyAt: { [Op.gt]: now } }],
    },
  });

interface AdServingDecision {
  campaign: AdCampaign | null;
  servable: boolean;
}

const getAdServingDecision = async (
  placementKey: string,
  now: Date
): Promise<AdServingDecision> => {
  const [placement, control, campaign] = await Promise.all([
    getOrCreatePlacement(placementKey),
    getSiteControl(),
    findScheduledCampaign(placementKey, now),
  ]);
  return {
    campaign,
    servable: Boolean(campaign && placement.enabled && control.adsEnabled),
  };
};

/** Resolves cache-safe ad content for an SSR document without issuing a token. */
export const getServableAdCreative = async (
  placementKey: string,
  now = new Date()
): Promise<AdCampaignCreative | null> => {
  if (!isMeasurementEnabled()) {
    return null;
  }
  const { campaign, servable } = await getAdServingDecision(placementKey, now);
  return servable && campaign ? asCreative(campaign) : null;
};

/** Issues one anonymous, short-lived measurement envelope for a mounted slot. */
export const issueAdExposure = async (
  placementKey: string,
  now = new Date()
): Promise<AdExposure> => {
  if (!isMeasurementEnabled()) {
    return { creative: null, expiresAt: null, token: null };
  }
  const { campaign, servable } = await getAdServingDecision(placementKey, now);
  const token = `${EXPOSURE_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + EXPOSURE_TTL_MS);
  // resolve pacific reporting bucket
  const reportingTime = DateTime.fromJSDate(now).setZone("America/Los_Angeles");
  const businessDate = reportingTime.toISODate();
  if (!businessDate) {
    throw new Error("Could not determine ad reporting date");
  }
  await AdMeasurementExposure.create({
    businessDate,
    businessHour: reportingTime.hour,
    campaignId: campaign?.id ?? null,
    expiresAt,
    placementKey,
    servable,
    tokenHash: hashSecret(token),
  });
  return {
    creative: servable && campaign ? asCreative(campaign) : null,
    expiresAt: expiresAt.toISOString(),
    token,
  };
};

// roll up one placement opportunity
const incrementPlacementOpportunity = async (
  exposure: AdMeasurementExposure,
  transaction: Transaction
): Promise<void> => {
  await db.query(
    `WITH hourly AS (
       INSERT INTO "AdPlacementHourlyMetrics"
         ("businessDate", "businessHour", "placementKey", "opportunityCount")
       VALUES (:businessDate, :businessHour, :placementKey, 1)
       ON CONFLICT ("businessDate", "businessHour", "placementKey") DO UPDATE
       SET "opportunityCount" = "AdPlacementHourlyMetrics"."opportunityCount" + 1
       RETURNING 1
     )
     INSERT INTO "AdPlacementDailyMetrics"
      ("businessDate", "placementKey", "opportunityCount")
     VALUES (:businessDate, :placementKey, 1)
     ON CONFLICT ("businessDate", "placementKey") DO UPDATE
     SET "opportunityCount" = "AdPlacementDailyMetrics"."opportunityCount" + 1`,
    {
      replacements: {
        businessDate: exposure.businessDate,
        businessHour: exposure.businessHour,
        placementKey: exposure.placementKey,
      },
      transaction,
      type: QueryTypes.INSERT,
    }
  );
};

const incrementCampaign = async ({
  campaignId,
  click = 0,
  opportunity = 0,
  served = 0,
  viewable = 0,
  businessDate,
  transaction,
}: {
  businessDate: string;
  campaignId: string;
  click?: number;
  opportunity?: number;
  served?: number;
  transaction: Transaction;
  viewable?: number;
}): Promise<void> => {
  await db.query(
    `INSERT INTO "AdCampaignDailyMetrics"
      ("businessDate", "campaignId", "opportunityCount", "servedCount", "viewableCount", "clickCount")
     VALUES (:businessDate, :campaignId, :opportunity, :served, :viewable, :click)
     ON CONFLICT ("businessDate", "campaignId") DO UPDATE SET
       "opportunityCount" = "AdCampaignDailyMetrics"."opportunityCount" + EXCLUDED."opportunityCount",
       "servedCount" = "AdCampaignDailyMetrics"."servedCount" + EXCLUDED."servedCount",
       "viewableCount" = "AdCampaignDailyMetrics"."viewableCount" + EXCLUDED."viewableCount",
       "clickCount" = "AdCampaignDailyMetrics"."clickCount" + EXCLUDED."clickCount"`,
    {
      replacements: {
        businessDate,
        campaignId,
        click,
        opportunity,
        served,
        viewable,
      },
      transaction,
      type: QueryTypes.INSERT,
    }
  );
};

/** Claims an exposure event once and atomically rolls it into daily totals. */
export const claimAdExposure = async (
  token: string,
  event: ClaimEvent,
  expectedCampaignId?: string,
  now = new Date()
): Promise<void> => {
  if (!isMeasurementEnabled() || !token.startsWith(EXPOSURE_PREFIX)) {
    return;
  }
  await db.transaction(async (transaction) => {
    const exposure = await AdMeasurementExposure.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: {
        expiresAt: { [Op.gt]: now },
        tokenHash: hashSecret(token),
      },
    });
    if (!exposure) {
      return;
    }
    if (expectedCampaignId && exposure.campaignId !== expectedCampaignId) {
      return;
    }
    if (event === "opportunity") {
      if (exposure.opportunityClaimed) {
        return;
      }
      await incrementPlacementOpportunity(exposure, transaction);
      if (exposure.campaignId) {
        await incrementCampaign({
          businessDate: exposure.businessDate,
          campaignId: exposure.campaignId,
          opportunity: 1,
          transaction,
        });
      }
      await exposure.update({ opportunityClaimed: true }, { transaction });
      return;
    }
    if (!exposure.servable || !exposure.campaignId) {
      return;
    }
    let alreadyClaimed = exposure.clickClaimed;
    if (event === "served") {
      alreadyClaimed = exposure.servedClaimed;
    } else if (event === "viewable") {
      alreadyClaimed = exposure.viewableClaimed;
    }
    if (alreadyClaimed) {
      return;
    }
    const fillServed = !exposure.servedClaimed;
    await incrementCampaign({
      businessDate: exposure.businessDate,
      campaignId: exposure.campaignId,
      click: event === "click" ? 1 : 0,
      served: fillServed ? 1 : 0,
      transaction,
      viewable: event === "viewable" ? 1 : 0,
    });
    await exposure.update(
      {
        ...(event === "click" ? { clickClaimed: true } : {}),
        servedClaimed: true,
        ...(event === "viewable" ? { viewableClaimed: true } : {}),
      },
      { transaction }
    );
  });
};

/** Resolves a persisted campaign destination and attempts a click claim. */
export const resolveAdClick = async ({
  campaignId,
  token,
}: {
  campaignId: string;
  token: string;
}): Promise<string | null> => {
  if (!UUID_PATTERN.test(campaignId)) {
    return null;
  }
  const campaign = await AdCampaign.findByPk(campaignId, {
    attributes: ["id", "targetUrl"],
  });
  if (!campaign || !campaign.targetUrl.startsWith("https://")) {
    return null;
  }
  try {
    await claimAdExposure(token, "click", campaignId);
  } catch {
    // Navigation uses the immutable, already-validated campaign destination
    // even when the informational measurement transaction is unavailable.
    logger.warn("Ad click measurement failed; continuing navigation");
  }
  return campaign.targetUrl;
};

/** Deletes a bounded batch of expired anonymous validation rows. */
export const cleanupExpiredAdExposures = async (
  limit = 5_000
): Promise<number> => {
  const deleted = await db.query<{ tokenHash: string }>(
    `WITH expired AS (
       SELECT "tokenHash" FROM "AdMeasurementExposures"
       WHERE "expiresAt" <= NOW()
       ORDER BY "expiresAt" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT :limit
     )
     DELETE FROM "AdMeasurementExposures" exposure
     USING expired
     WHERE exposure."tokenHash" = expired."tokenHash"
     RETURNING exposure."tokenHash" AS "tokenHash"`,
    { replacements: { limit }, type: QueryTypes.SELECT }
  );
  return deleted.length;
};
