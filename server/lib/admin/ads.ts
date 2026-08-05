import {
  AD_SLOT_IDS,
  type AdConfiguration,
  type AdPlacement as AdPlacementContract,
  type AdSlotId,
  getAdPlacementKey,
  parseAdPlacementKey,
} from "shared/contracts/ads";
import { isObject } from "shared/lib/objects";

import { AdPlacement } from "~/models/AdPlacement";
import { SiteControl } from "~/models/SiteControl";

const SITE_CONTROL_KEY = "public";
const MAX_ADVERTISER_NAME_LENGTH = 120;
const MAX_BODY_LENGTH = 1_000;
const MAX_HEADLINE_LENGTH = 180;
const MAX_TARGET_URL_LENGTH = 2_048;
const safePlacementKeyPattern =
  /^(?:home|(?:schedule|cameras|terminal|fare)--[A-Za-z0-9_][A-Za-z0-9_-]*--[A-Za-z0-9_][A-Za-z0-9_-]*)$/;

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

const asPlacement = (placement: AdPlacement): AdPlacementContract => ({
  advertiserName: placement.advertiserName,
  arrivalTerminalId: placement.arrivalTerminalId,
  body: placement.body,
  departureTerminalId: placement.departureTerminalId,
  enabled: placement.enabled,
  headline: placement.headline,
  key: placement.key,
  slot: placement.slot,
  targetUrl: placement.targetUrl,
});

const isSlot = (value: unknown): value is AdSlotId =>
  typeof value === "string" &&
  (AD_SLOT_IDS as readonly string[]).includes(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const normalizedRequiredText = (
  value: unknown,
  maxLength: number
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
};

const normalizedBody = (value: unknown): string | undefined => {
  if (typeof value === "undefined") {
    return "";
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length <= MAX_BODY_LENGTH ? normalized : undefined;
};

const normalizedHttpsUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > MAX_TARGET_URL_LENGTH) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

export const isSafeAdPlacementKey = (value: string): boolean =>
  value.length <= 300 && safePlacementKeyPattern.test(value);

const parsePlacement = (
  routeKey: string,
  value: unknown
): Omit<AdPlacementContract, "key"> => {
  if (
    !isObject(value) ||
    !isSlot(value.slot) ||
    !isNullableString(value.departureTerminalId) ||
    !isNullableString(value.arrivalTerminalId) ||
    typeof value.enabled !== "boolean"
  ) {
    throw new Error("Invalid ad placement");
  }
  let key: string;
  try {
    key = getAdPlacementKey({
      arrivalTerminalId: value.arrivalTerminalId,
      departureTerminalId: value.departureTerminalId,
      slot: value.slot,
    });
  } catch {
    throw new Error("Invalid ad placement");
  }
  if (
    key !== routeKey ||
    !parseAdPlacementKey(routeKey) ||
    ("key" in value && value.key !== routeKey) ||
    !isSafeAdPlacementKey(routeKey)
  ) {
    throw new Error("Invalid ad placement");
  }
  const advertiserName = normalizedRequiredText(
    value.advertiserName,
    MAX_ADVERTISER_NAME_LENGTH
  );
  const headline = normalizedRequiredText(value.headline, MAX_HEADLINE_LENGTH);
  const body = normalizedBody(value.body);
  const targetUrl = normalizedHttpsUrl(value.targetUrl);
  if (!advertiserName || !headline || typeof body !== "string" || !targetUrl) {
    throw new Error("Invalid ad placement");
  }
  return {
    advertiserName,
    arrivalTerminalId: value.arrivalTerminalId,
    body,
    departureTerminalId: value.departureTerminalId,
    enabled: value.enabled,
    headline,
    slot: value.slot,
    targetUrl,
  };
};

export const getAdminAds = async (): Promise<AdConfiguration> => {
  const [control, placements] = await Promise.all([
    getSiteControl(),
    AdPlacement.findAll({ order: [["key", "ASC"]] }),
  ]);
  return {
    adsEnabled: control.adsEnabled,
    placements: placements.map(asPlacement),
  };
};

export const setAdsEnabled = async (
  value: unknown
): Promise<AdConfiguration> => {
  if (!isObject(value) || typeof value.adsEnabled !== "boolean") {
    throw new Error("Invalid ad settings");
  }
  const control = await getSiteControl();
  await control.update({ adsEnabled: value.adsEnabled });
  return getAdminAds();
};

export const saveAdPlacement = async (
  key: string,
  value: unknown
): Promise<AdConfiguration> => {
  const placementValue = parsePlacement(key, value);
  const [placement] = await AdPlacement.findOrCreate({
    defaults: { key, ...placementValue },
    where: { key },
  });
  await placement.update(placementValue);
  return getAdminAds();
};
