import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  type AdExposure,
  type AdMeasurementEvent,
  type AdSlotId,
  parseAdPlacementKey,
} from "shared/contracts/ads";

import { post, postKeepalive } from "~/lib/api";

const MEASUREMENT_ATTEMPTS = 2;
const MEASUREMENT_RETRY_DELAY_MS = 150;

export interface AdAdminSelection {
  directionKey: string;
  placementKey: string;
  slot: AdSlotId;
}

/** Builds the owner-console deep link for one canonical ad placement. */
export const getAdAdminConfigurationPath = (placementKey: string): string => {
  if (!parseAdPlacementKey(placementKey)) {
    throw new Error("Invalid ad placement key");
  }
  const params = new URLSearchParams({ placement: placementKey, tab: "ads" });
  return `/admin?${params.toString()}#admin-ad-placement`;
};

/** Reads a validated placement selection from an admin-page query string. */
export const getAdAdminSelection = (
  search: string
): AdAdminSelection | null => {
  const placementKey = new URLSearchParams(search).get("placement") ?? "";
  const placement = parseAdPlacementKey(placementKey);
  if (!placement) {
    return null;
  }
  return {
    directionKey:
      placement.slot === "home"
        ? ""
        : `${placement.departureTerminalId}--${placement.arrivalTerminalId}`,
    placementKey,
    slot: placement.slot,
  };
};

const wait = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const issueAdExposure = async (
  placementKey: string
): Promise<AdExposure> =>
  await post<AdExposure>("/ads/exposures", { placementKey });

export const measureAdExposure = async (
  token: string,
  event: AdMeasurementEvent
): Promise<void> => {
  for (let attempt = 1; attempt <= MEASUREMENT_ATTEMPTS; attempt += 1) {
    try {
      await postKeepalive("/ads/measure", { event, token });
      return;
    } catch (error) {
      if (attempt === MEASUREMENT_ATTEMPTS) {
        throw error;
      }
      await wait(MEASUREMENT_RETRY_DELAY_MS);
    }
  }
};

/** Records a web click without delaying the browser's direct navigation. */
export const recordWebAdClick = async ({
  campaignId,
  token,
}: {
  campaignId: string;
  token: string;
}): Promise<void> => {
  await postKeepalive("/ads/click", { campaignId, token });
};

/** Records a native click through the API before opening the persisted target. */
export const openNativeAdClick = async ({
  campaignId,
  fallbackTargetUrl,
  token,
}: {
  campaignId: string;
  fallbackTargetUrl: string;
  token: string;
}): Promise<void> => {
  let targetUrl = fallbackTargetUrl;
  try {
    const response = await post<{ targetUrl: string }>("/ads/click", {
      campaignId,
      token,
    });
    ({ targetUrl } = response);
  } catch {
    // The immutable creative target remains the rider-continuity fallback.
  }
  await Browser.open({ url: targetUrl });
};

export const isNativeAdPlatform = (): boolean => Capacitor.isNativePlatform();
