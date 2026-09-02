export const AD_SLOT_IDS = [
  "home",
  "schedule",
  "cameras",
  "terminal",
  "fare",
] as const;

export type AdSlotId = (typeof AD_SLOT_IDS)[number];

export interface AdPlacement {
  advertiserName: string;
  arrivalTerminalId: string | null;
  body: string;
  departureTerminalId: string | null;
  enabled: boolean;
  headline: string;
  key: string;
  slot: AdSlotId;
  targetUrl: string;
}

export interface AdConfiguration {
  adsEnabled: boolean;
  placements: AdPlacement[];
}

export type AdMeasurementEvent = "opportunity" | "served" | "viewable";

export interface AdCampaignCreative {
  advertiserName: string;
  body: string;
  campaignId: string;
  headline: string;
  placementKey: string;
  targetUrl: string;
}

export interface AdExposure {
  creative: AdCampaignCreative | null;
  expiresAt: string | null;
  token: string | null;
}

export interface AdCampaign {
  advertiserName: string;
  arrivalTerminalId: string | null;
  body: string;
  departureTerminalId: string | null;
  endedEarlyAt: string | null;
  endsAt: string;
  headline: string;
  id: string;
  placementKey: string;
  reportName: string;
  slot: AdSlotId;
  startsAt: string;
  targetUrl: string;
}

export interface AdDailyMetrics {
  businessDate: string;
  clickCount: string;
  opportunityCount: string;
  servedCount: string;
  viewableCount: string;
}

export interface AdCampaignReport {
  campaign: AdCampaign;
  daily: AdDailyMetrics[];
  methodology: string;
  totals: Omit<AdDailyMetrics, "businessDate"> & {
    clickThroughRate: string | null;
    viewableClickThroughRate: string | null;
    viewabilityRate: string | null;
  };
}

export interface AdInventoryDailyMetrics {
  businessDate: string;
  opportunityCount: string;
  placementKey: string;
}

export interface AdInventoryPlacementSummary {
  opportunityCount: string;
  placementKey: string;
}

export interface AdInventoryWeekdayMetrics {
  opportunityCount: string;
  weekday: number;
}

export interface AdInventoryHourMetrics {
  hour: number;
  opportunityCount: string;
}

export interface AdInventoryPlacementBreakdown {
  hourOfDay: AdInventoryHourMetrics[];
  hourlyDataStartDate: string | null;
  opportunityCount: string;
  placementKey: string;
  weekday: AdInventoryWeekdayMetrics[];
}

export interface AdInventoryReport {
  daily: AdInventoryDailyMetrics[];
  endDate: string;
  placements: AdInventoryPlacementSummary[];
  selectedPlacement: AdInventoryPlacementBreakdown | null;
  startDate: string;
  totalOpportunityCount: string;
}

export interface AdReportShareSummary {
  campaignId: string;
  createdAt: string;
  id: string;
  revokedAt: string | null;
}

export interface AdReportShareCreated extends AdReportShareSummary {
  url: string;
}

type AdPlacementKeyInput = Pick<
  AdPlacement,
  "arrivalTerminalId" | "departureTerminalId" | "slot"
>;

const safeTerminalIdPattern = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** Returns the stable URL- and confirmation-safe key for an ad placement. */
export const getAdPlacementKey = ({
  arrivalTerminalId,
  departureTerminalId,
  slot,
}: AdPlacementKeyInput): string => {
  if (slot === "home") {
    if (departureTerminalId === null && arrivalTerminalId === null) {
      return slot;
    }
    throw new Error("Invalid ad placement direction");
  }
  if (
    departureTerminalId === null ||
    arrivalTerminalId === null ||
    !safeTerminalIdPattern.test(departureTerminalId) ||
    !safeTerminalIdPattern.test(arrivalTerminalId) ||
    departureTerminalId.includes("--") ||
    arrivalTerminalId.includes("--")
  ) {
    throw new Error("Invalid ad placement direction");
  }
  return `${slot}--${departureTerminalId}--${arrivalTerminalId}`;
};

export interface ParsedAdPlacementKey {
  arrivalTerminalId: string | null;
  departureTerminalId: string | null;
  slot: AdSlotId;
}

/** Parses only placement keys backed by Ferry FYI's canonical route catalog. */
export const parseAdPlacementKey = (
  key: string
): ParsedAdPlacementKey | null => {
  if (key === "home") {
    return {
      arrivalTerminalId: null,
      departureTerminalId: null,
      slot: "home",
    };
  }
  const [slotValue, departureTerminalId, arrivalTerminalId, extra] =
    key.split("--");
  if (
    extra !== undefined ||
    slotValue === "home" ||
    !(AD_SLOT_IDS as readonly string[]).includes(slotValue) ||
    !departureTerminalId ||
    !arrivalTerminalId ||
    departureTerminalId === arrivalTerminalId
  ) {
    return null;
  }
  const canonicalDirection = Object.values(ROUTE_TERMINAL_IDS).some(
    ({ terminalIds }) =>
      terminalIds.includes(departureTerminalId) &&
      terminalIds.includes(arrivalTerminalId)
  );
  if (!canonicalDirection) {
    return null;
  }
  const slot = slotValue as AdSlotId;
  try {
    return getAdPlacementKey({
      arrivalTerminalId,
      departureTerminalId,
      slot,
    }) === key
      ? { arrivalTerminalId, departureTerminalId, slot }
      : null;
  } catch {
    return null;
  }
};
import ROUTE_TERMINAL_IDS from "../data/route-terminal-ids.json";
