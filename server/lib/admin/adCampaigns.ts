import { createHash, randomBytes, randomUUID } from "crypto";
import { DateTime } from "luxon";
import { Op, QueryTypes } from "sequelize";
import {
  type AdCampaign as AdCampaignContract,
  type AdCampaignReport,
  type AdDailyMetrics,
  type AdInventoryDailyMetrics,
  type AdInventoryPlacementSummary,
  type AdInventoryReport,
  type AdReportShareCreated,
  type AdReportShareSummary,
  parseAdPlacementKey,
} from "shared/contracts/ads";
import { isObject } from "shared/lib/objects";

import { db } from "~/lib/db";
import { AdCampaign } from "~/models/AdCampaign";
import { AdCampaignDailyMetric } from "~/models/AdCampaignDailyMetric";
import { AdPlacement } from "~/models/AdPlacement";
import { AdPlacementDailyMetric } from "~/models/AdPlacementDailyMetric";
import { AdPlacementHourlyMetric } from "~/models/AdPlacementHourlyMetric";
import { AdReportShare } from "~/models/AdReportShare";

const REPORT_PREFIX = "adr_";
const METHODOLOGY =
  "Aggregate informational reporting by the exposure's America/Los_Angeles issuance date. An opportunity is a fully visible slot marker for one continuous second, including scheduled pauses when serving is switched off. A viewable impression is at least 50% of the creative for one continuous second. Click-through rate divides clicks by served ads; viewable click-through rate divides clicks by viewable impressions. Counts are not unique people, audited fraud-free traffic, or billable units.";

const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

const asCampaign = (campaign: AdCampaign): AdCampaignContract => ({
  advertiserName: campaign.advertiserName,
  arrivalTerminalId: campaign.arrivalTerminalId,
  body: campaign.body,
  departureTerminalId: campaign.departureTerminalId,
  endedEarlyAt: iso(campaign.endedEarlyAt),
  endsAt: campaign.endsAt.toISOString(),
  headline: campaign.headline,
  id: campaign.id,
  placementKey: campaign.placementKey,
  reportName: campaign.reportName,
  slot: campaign.slot,
  startsAt: campaign.startsAt.toISOString(),
  targetUrl: campaign.targetUrl,
});

const normalizedDate = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const normalizedReportName = (value: unknown): string | null =>
  typeof value === "string" && value.trim() && value.trim().length <= 160
    ? value.trim()
    : null;

export const listAdCampaigns = async (
  placementKey?: string
): Promise<AdCampaignContract[]> =>
  (
    await AdCampaign.findAll({
      order: [["startsAt", "DESC"]],
      ...(placementKey ? { where: { placementKey } } : {}),
    })
  ).map(asCampaign);

/** Snapshots one configured placement into an immutable scheduled campaign. */
export const scheduleAdCampaign = async (
  value: unknown
): Promise<AdCampaignContract> => {
  if (!isObject(value) || typeof value.placementKey !== "string") {
    throw new Error("Invalid ad campaign");
  }
  const reportName = normalizedReportName(value.reportName);
  const startsAt = normalizedDate(value.startsAt);
  const endsAt = normalizedDate(value.endsAt);
  if (!reportName || !startsAt || !endsAt || startsAt >= endsAt) {
    throw new Error("Invalid ad campaign");
  }
  return await db.transaction(async (transaction) => {
    const placement = await AdPlacement.findByPk(value.placementKey, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (
      !placement ||
      !placement.advertiserName ||
      !placement.headline ||
      !placement.targetUrl.startsWith("https://")
    ) {
      throw new Error("Configure this placement before scheduling a campaign");
    }
    const [overlap] = await db.query<{ id: string }>(
      `SELECT "id" FROM "AdCampaigns"
       WHERE "placementKey" = :placementKey
         AND "startsAt" < :endsAt
         AND LEAST("endsAt", COALESCE("endedEarlyAt", "endsAt")) > :startsAt
       LIMIT 1`,
      {
        replacements: {
          endsAt,
          placementKey: placement.key,
          startsAt,
        },
        transaction,
        type: QueryTypes.SELECT,
      }
    );
    if (overlap) {
      throw new Error("Campaign schedule overlaps an existing campaign");
    }
    const campaign = await AdCampaign.create(
      {
        advertiserName: placement.advertiserName,
        arrivalTerminalId: placement.arrivalTerminalId,
        body: placement.body,
        ctaLabel: placement.ctaLabel,
        departureTerminalId: placement.departureTerminalId,
        endsAt,
        headline: placement.headline,
        id: randomUUID(),
        placementKey: placement.key,
        reportName,
        slot: placement.slot,
        startsAt,
        targetUrl: placement.targetUrl,
      },
      { transaction }
    );
    return asCampaign(campaign);
  });
};

export const endAdCampaign = async (
  campaignId: string,
  now?: Date
): Promise<AdCampaignContract> =>
  await db.transaction(async (transaction) => {
    const campaign = await AdCampaign.findByPk(campaignId, { transaction });
    if (!campaign) {
      throw new Error("Ad campaign not found");
    }
    await AdPlacement.findByPk(campaign.placementKey, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await campaign.reload({ lock: transaction.LOCK.UPDATE, transaction });
    if (!campaign.endedEarlyAt) {
      const endedAt =
        now ??
        (
          await db.query<{ now: Date }>('SELECT NOW() AS "now"', {
            transaction,
            type: QueryTypes.SELECT,
          })
        )[0]?.now;
      if (!endedAt) {
        throw new Error("Could not end ad campaign");
      }
      await campaign.update(
        {
          endedEarlyAt: endedAt > campaign.endsAt ? campaign.endsAt : endedAt,
        },
        { transaction }
      );
    }
    return asCampaign(campaign);
  });

const asCount = (value: unknown): string => String(value ?? "0");

const sum = (
  rows: AdDailyMetrics[],
  key: keyof Omit<AdDailyMetrics, "businessDate">
): string =>
  rows.reduce((total, row) => total + BigInt(row[key]), BigInt(0)).toString();

// format one rounded percentage
const rate = (numerator: string, denominator: string): string | null => {
  const bottom = BigInt(denominator);
  // omit undefined rates
  if (bottom === BigInt(0)) {
    return null;
  }
  const hundredths =
    (BigInt(numerator) * BigInt(10_000) + bottom / BigInt(2)) / bottom;
  const hundred = BigInt(100);
  return `${hundredths / hundred}.${String(hundredths % hundred).padStart(2, "0")}%`;
};

export const getAdCampaignReport = async (
  campaignId: string
): Promise<AdCampaignReport> => {
  const campaign = await AdCampaign.findByPk(campaignId);
  if (!campaign) {
    throw Object.assign(new Error("Ad campaign not found"), { status: 404 });
  }
  const daily: AdDailyMetrics[] = (
    await AdCampaignDailyMetric.findAll({
      order: [["businessDate", "ASC"]],
      where: { campaignId },
    })
  ).map((row) => ({
    businessDate: row.businessDate,
    clickCount: asCount(row.clickCount),
    opportunityCount: asCount(row.opportunityCount),
    servedCount: asCount(row.servedCount),
    viewableCount: asCount(row.viewableCount),
  }));
  const clickCount = sum(daily, "clickCount");
  const opportunityCount = sum(daily, "opportunityCount");
  const servedCount = sum(daily, "servedCount");
  const viewableCount = sum(daily, "viewableCount");
  return {
    campaign: asCampaign(campaign),
    daily,
    methodology: METHODOLOGY,
    totals: {
      clickCount,
      clickThroughRate: rate(clickCount, servedCount),
      opportunityCount,
      servedCount,
      viewableClickThroughRate: rate(clickCount, viewableCount),
      viewabilityRate: rate(viewableCount, servedCount),
      viewableCount,
    },
  };
};

const parseBusinessDate = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const date = DateTime.fromISO(value, { zone: "America/Los_Angeles" });
  return date.isValid && date.toISODate() === value ? value : null;
};

// aggregate inventory by placement
const placementSummaries = (
  daily: AdInventoryDailyMetrics[],
  placementKeys: string[]
): AdInventoryPlacementSummary[] => {
  const totals = new Map<string, bigint>(
    placementKeys.map((placementKey) => [placementKey, BigInt(0)])
  );
  // merge measured totals into tracked placements
  daily.forEach((row) => {
    totals.set(
      row.placementKey,
      (totals.get(row.placementKey) ?? BigInt(0)) + BigInt(row.opportunityCount)
    );
  });
  return [...totals.entries()]
    .map(([placementKey, opportunityCount]) => ({
      opportunityCount: opportunityCount.toString(),
      placementKey,
    }))
    .sort((left, right) => {
      const leftCount = BigInt(left.opportunityCount);
      const rightCount = BigInt(right.opportunityCount);
      // keep stable count ordering
      if (leftCount === rightCount) {
        return left.placementKey.localeCompare(right.placementKey);
      }
      return leftCount > rightCount ? -1 : 1;
    });
};

// build bounded placement analytics
export const getAdInventoryReport = async ({
  endDate: endValue,
  placementKey: placementKeyValue,
  startDate: startValue,
}: {
  endDate: unknown;
  placementKey?: unknown;
  startDate: unknown;
}): Promise<AdInventoryReport> => {
  const startDate = parseBusinessDate(startValue);
  const endDate = parseBusinessDate(endValue);
  const placementKeyCandidate =
    typeof placementKeyValue === "string" &&
    placementKeyValue.length > 0 &&
    placementKeyValue.length <= 255
      ? placementKeyValue
      : null;
  // reject malformed drill-down keys before querying
  if (placementKeyValue !== undefined && !placementKeyCandidate) {
    throw new Error("Invalid ad placement");
  }
  // validate the calendar range
  if (!startDate || !endDate || startDate > endDate) {
    throw new Error("Invalid report range");
  }
  const { days } = DateTime.fromISO(endDate).diff(
    DateTime.fromISO(startDate),
    "days"
  );
  // bound report work
  if (days > 366) {
    throw new Error("Report range is too large");
  }
  const [dailyRows, hourlyRows, placementRows] = await Promise.all([
    AdPlacementDailyMetric.findAll({
      order: [
        ["businessDate", "ASC"],
        ["placementKey", "ASC"],
      ],
      where: { businessDate: { [Op.between]: [startDate, endDate] } },
    }),
    placementKeyCandidate
      ? AdPlacementHourlyMetric.findAll({
          order: [
            ["businessDate", "ASC"],
            ["businessHour", "ASC"],
          ],
          where: {
            businessDate: { [Op.between]: [startDate, endDate] },
            placementKey: placementKeyCandidate,
          },
        })
      : Promise.resolve([]),
    AdPlacement.findAll({ attributes: ["key"], order: [["key", "ASC"]] }),
  ]);
  const daily: AdInventoryDailyMetrics[] = dailyRows.map((row) => ({
    businessDate: row.businessDate,
    opportunityCount: asCount(row.opportunityCount),
    placementKey: row.placementKey,
  }));
  const placements = placementSummaries(
    daily,
    placementRows.map((placement) => placement.key)
  );
  const placementKey =
    placementKeyCandidate &&
    (parseAdPlacementKey(placementKeyCandidate) ||
      placements.some(
        (placement) => placement.placementKey === placementKeyCandidate
      ))
      ? placementKeyCandidate
      : null;
  // accept only canonical or measured historical placements
  if (placementKeyCandidate && !placementKey) {
    throw new Error("Invalid ad placement");
  }
  const selectedDaily = placementKey
    ? daily.filter((row) => row.placementKey === placementKey)
    : [];
  const selectedTotal = selectedDaily
    .reduce((total, row) => total + BigInt(row.opportunityCount), BigInt(0))
    .toString();
  const weekdayTotals = selectedDaily.reduce((totals, row) => {
    const { weekday } = DateTime.fromISO(row.businessDate, {
      zone: "America/Los_Angeles",
    });
    totals.set(
      weekday,
      (totals.get(weekday) ?? BigInt(0)) + BigInt(row.opportunityCount)
    );
    return totals;
  }, new Map<number, bigint>());
  const hourTotals = hourlyRows.reduce((totals, row) => {
    totals.set(
      row.businessHour,
      (totals.get(row.businessHour) ?? BigInt(0)) + BigInt(row.opportunityCount)
    );
    return totals;
  }, new Map<number, bigint>());
  return {
    daily,
    endDate,
    placements,
    selectedPlacement: placementKey
      ? {
          hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            opportunityCount: (hourTotals.get(hour) ?? BigInt(0)).toString(),
          })),
          hourlyDataStartDate: hourlyRows[0]?.businessDate ?? null,
          opportunityCount: selectedTotal,
          placementKey,
          weekday: Array.from({ length: 7 }, (_, index) => ({
            opportunityCount: (
              weekdayTotals.get(index + 1) ?? BigInt(0)
            ).toString(),
            weekday: index + 1,
          })),
        }
      : null,
    startDate,
    totalOpportunityCount: daily
      .reduce((total, row) => total + BigInt(row.opportunityCount), BigInt(0))
      .toString(),
  };
};

const asShare = (share: AdReportShare): AdReportShareSummary => ({
  campaignId: share.campaignId,
  createdAt: share.createdAt.toISOString(),
  id: share.id,
  revokedAt: iso(share.revokedAt),
});

export const listAdReportShares = async (
  campaignId: string
): Promise<AdReportShareSummary[]> =>
  (
    await AdReportShare.findAll({
      order: [["createdAt", "DESC"]],
      where: { campaignId },
    })
  ).map(asShare);

// resolve the same-origin report base
const reportBaseUrl = (): string => {
  const configured = process.env.BASE_URL;
  // require production configuration
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("BASE_URL is required");
  }
  const url = new URL(configured ?? "http://localhost:4040");
  // require production transport
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("BASE_URL must use HTTPS in production");
  }
  return url.origin;
};

export const createAdReportShare = async (
  campaignId: string
): Promise<AdReportShareCreated> => {
  if (!(await AdCampaign.findByPk(campaignId, { attributes: ["id"] }))) {
    throw new Error("Ad campaign not found");
  }
  const baseUrl = reportBaseUrl();
  const token = `${REPORT_PREFIX}${randomBytes(32).toString("base64url")}`;
  const share = await AdReportShare.create({
    campaignId,
    createdAt: new Date(),
    id: randomUUID(),
    tokenHash: hashSecret(token),
  });
  return { ...asShare(share), url: `${baseUrl}/ad-reports/#${token}` };
};

export const revokeAdReportShare = async (
  shareId: string
): Promise<AdReportShareSummary> => {
  await db.query(
    `UPDATE "AdReportShares"
     SET "revokedAt" = COALESCE("revokedAt", NOW())
     WHERE "id" = :shareId`,
    {
      replacements: { shareId },
      type: QueryTypes.UPDATE,
    }
  );
  const share = await AdReportShare.findByPk(shareId);
  if (!share) {
    throw new Error("Ad report share not found");
  }
  return asShare(share);
};

export const getSharedAdCampaignReport = async (
  token: unknown
): Promise<AdCampaignReport | null> => {
  if (typeof token !== "string" || !token.startsWith(REPORT_PREFIX)) {
    return null;
  }
  const share = await AdReportShare.findOne({
    attributes: ["campaignId"],
    where: { revokedAt: null, tokenHash: hashSecret(token) },
  });
  return share ? await getAdCampaignReport(share.campaignId) : null;
};

const csvCell = (value: string): string => {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const campaignReportCsv = (report: AdCampaignReport): string => {
  const header = [
    "date",
    "placement",
    "opportunities",
    "served",
    "viewable",
    "clicks",
  ];
  return [
    header.map(csvCell).join(","),
    ...report.daily.map((row) =>
      [
        row.businessDate,
        report.campaign.placementKey,
        row.opportunityCount,
        row.servedCount,
        row.viewableCount,
        row.clickCount,
      ]
        .map(csvCell)
        .join(",")
    ),
  ].join("\n");
};
