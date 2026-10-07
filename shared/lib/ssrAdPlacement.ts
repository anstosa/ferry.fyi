import {
  type AdCampaignCreative,
  type AdSlotId,
  getAdPlacementKey,
} from "../contracts/ads";
import type { PublicSsrRouteId, PublicSsrView } from "../contracts/ssrRouting";
import type { PublicSsrRouteMatch } from "./ssrRouteMatch";

const AD_SLOT_FOR_VIEW: Partial<Record<PublicSsrView, AdSlotId>> = {
  cameras: "cameras",
  fare: "fare",
  schedule: "schedule",
  terminal: "terminal",
};

export interface PublicSsrAdRouteIdentity {
  readonly arrivalTerminalId: string | null;
  readonly canonicalPath: string;
  readonly departureTerminalId: string | null;
  readonly routeId: PublicSsrRouteId;
}

export interface PublicSsrAdPlacementBinding {
  readonly placementKey: string;
  readonly routeIdentity: PublicSsrAdRouteIdentity;
}

export interface PublicSsrAdServingBinding extends PublicSsrAdPlacementBinding {
  readonly creative: AdCampaignCreative | null;
  readonly fingerprint: string;
}

export interface PublicSsrAdRouteSeed {
  readonly arrivalTerminalId: string;
  readonly departureTerminalId: string;
}

/** Selects the public ad placement from a canonical route and route seed. */
export const getPublicSsrAdPlacementBinding = (
  match: PublicSsrRouteMatch,
  seed?: PublicSsrAdRouteSeed
): PublicSsrAdPlacementBinding | undefined => {
  // bind the site-wide home placement without a route seed
  if (match.route.id === "home") {
    return {
      placementKey: "home",
      routeIdentity: {
        arrivalTerminalId: null,
        canonicalPath: match.canonicalPath,
        departureTerminalId: null,
        routeId: match.route.id,
      },
    };
  }
  const slot = match.route.view
    ? AD_SLOT_FOR_VIEW[match.route.view]
    : undefined;
  // ignore routes that do not carry public ads
  if (!slot) {
    return undefined;
  }
  // require the exact canonical route direction
  if (!seed) {
    throw new Error("Public SSR ad route seed is required");
  }
  return {
    placementKey: getAdPlacementKey({
      arrivalTerminalId: seed.arrivalTerminalId,
      departureTerminalId: seed.departureTerminalId,
      slot,
    }),
    routeIdentity: {
      arrivalTerminalId: seed.arrivalTerminalId,
      canonicalPath: match.canonicalPath,
      departureTerminalId: seed.departureTerminalId,
      routeId: match.route.id,
    },
  };
};

/** Compares a loader-derived placement with its runtime binding. */
export const samePublicSsrAdPlacementBinding = (
  expected: PublicSsrAdPlacementBinding,
  actual: PublicSsrAdPlacementBinding
): boolean =>
  expected.placementKey === actual.placementKey &&
  expected.routeIdentity.arrivalTerminalId ===
    actual.routeIdentity.arrivalTerminalId &&
  expected.routeIdentity.canonicalPath === actual.routeIdentity.canonicalPath &&
  expected.routeIdentity.departureTerminalId ===
    actual.routeIdentity.departureTerminalId &&
  expected.routeIdentity.routeId === actual.routeIdentity.routeId;
