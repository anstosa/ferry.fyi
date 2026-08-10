import type { GetScheduleResponse } from "../api/schedules";
import type { AdCampaignCreative } from "./ads";
import type { WSFStatus } from "./api";
import type { Bulletin } from "./bulletins";
import type { PublicSsrCameraFrameStatusEnvelope } from "./cameraFrames";
import type { Camera } from "./cameras";
import type { FareCurrentCatalogResponse, FareNoFareResponse } from "./fares";
import type { Leaderboard, LeaderboardPeriod } from "./leaderboards";
import type { Route } from "./routes";
import type {
  PublicSsrRouteId,
  PublicSsrRouteParams,
  PublicSsrSourceKey,
} from "./ssrRouting";
import type { TerminalInfo, WaitTime } from "./terminals";
import type { Vessel } from "./vessels";
export type {
  PublicSsrRouteDefinition,
  PublicSsrRouteId,
  PublicSsrRouteParams,
  PublicSsrSourceKey,
} from "./ssrRouting";

/** Versioned anonymous document data, never an API DTO. */
export const PUBLIC_SSR_SNAPSHOT_VERSION = 6 as const;
export const PUBLIC_SSR_FORBIDDEN_KEYS = [
  "accessToken",
  "idToken",
  "authorization",
  "cookie",
  "user",
  "userId",
  "sub",
  "email",
  "favoriteRouteIds",
  "alertRules",
  "tickets",
  "ticketHistory",
  "admin",
  "auth0",
  "firebase",
  "error",
  "errors",
  "privateUrl",
  "password",
  "pushToken",
  "quote",
  "fareQuote",
  "dataValues",
  "sequelize",
  "createdAt",
  "updatedAt",
] as const;
export type PublicSsrUnavailableReason =
  | "not-published"
  | "not-supported"
  | "source-unavailable";
export type PublicSsrTransientUnavailableReason = "refreshing" | "warming";
export type PublicSsrLoaderOnlyOutcome = "not-applicable" | "transient-failure";
/** A terminal reference used for mates; intentionally does not recurse. */
export interface PublicSsrTerminalIdentity {
  abbreviation: string;
  id: string;
  name: string;
}
export interface PublicSsrAddress {
  city: string | null;
  line1: string | null;
  line2: string | null;
  state: string | null;
  zip: string | null;
}
export interface PublicSsrTerminalLocation {
  address: PublicSsrAddress | null;
  latitude: number;
  link: string | null;
  longitude: number;
}
/** Compact home-directory data; detailed terminal data is route-scoped. */
export interface PublicSsrTerminalSummary extends PublicSsrTerminalIdentity {
  location: PublicSsrTerminalLocation;
}
export type PublicSsrRoute = Pick<
  Route,
  | "abbreviation"
  | "averageVehicleCapacity"
  | "crossingTime"
  | "date"
  | "description"
  | "galleyHours"
  | "id"
  | "normalVehicleCapacity"
  | "normalVehicleMaxCapacity"
  | "terminalIds"
>;
/**
 * Explicit non-recursive terminal projection for anonymous SSR. The routes
 * map is the one intentionally keyed public map; all values are finite routes.
 */
export interface PublicSsrTerminal extends PublicSsrTerminalIdentity {
  bulletins: readonly Bulletin[];
  cameras: readonly Camera[];
  hasElevator: boolean;
  hasFood: boolean;
  hasOverheadLoading: boolean;
  hasRestroom: boolean;
  hasWaitingRoom: boolean;
  info: TerminalInfo;
  location: PublicSsrTerminalLocation;
  mates: readonly PublicSsrTerminalIdentity[];
  popularity: number;
  routes: Readonly<Record<string, PublicSsrRoute>>;
  terminalUrl: string | null;
  vesselWatchUrl: string | null;
  waitTimes: readonly WaitTime[];
}
/** The selected terminal and its mate seed Route and TerminalDetails together. */
export interface PublicSsrRoutePayload {
  mate: PublicSsrTerminal;
  terminal: PublicSsrTerminal;
}
export type PublicSsrVessel = Pick<
  Vessel,
  | "id"
  | "name"
  | "abbreviation"
  | "inMaintenance"
  | "inService"
  | "location"
  | "heading"
  | "speed"
  | "isAtDock"
>;
export interface PublicSsrAnnouncement {
  body: string;
  id: string;
  title: string;
}
export interface PublicSsrFeatures {
  leaderboardsEnabled: boolean;
}
export interface PublicSsrNotices {
  announcements: readonly PublicSsrAnnouncement[];
  maintenance: { enabled: boolean; message: string };
}
/** Release-owned static content shared by editorial documents. */
export interface PublicSsrEditorial {
  contentRevision: string;
  release: { publishedAt: string | null; version: string };
}
/** Anonymous Tickets copy and capabilities; never ticket/account data. */
export interface PublicSsrTicketGuidance {
  capabilities: {
    barcodeScanner: "available" | "unavailable";
    savedTickets: "after-hydration";
    ticketLookup: "after-hydration";
  };
  guidance: { body: string; title: string };
}
export interface PublicSsrAlertGuidance {
  body: string;
  title: string;
}
/** Cache-safe ad content. Per-visitor measurement envelopes are never serialized. */
export interface PublicSsrAd {
  creative: AdCampaignCreative | null;
  placementKey: string;
}
export interface PublicSsrLeaderboard extends Leaderboard {
  entity: { id: string; kind: "system" | "terminal" | "vessel"; label: string };
  period: LeaderboardPeriod;
}
/** Index data supplies public labels; entity data carries the selected ranks. */
export interface PublicSsrLeaderboardIndex {
  defaultPeriod: LeaderboardPeriod;
  entities: readonly {
    id: string;
    kind: "system" | "terminal" | "vessel";
    label: string;
  }[];
}
export interface PublicSsrPayloadMap {
  ad: PublicSsrAd;
  terminals: readonly PublicSsrTerminalSummary[];
  features: PublicSsrFeatures;
  editorial: PublicSsrEditorial;
  ticketGuidance: PublicSsrTicketGuidance;
  notices: PublicSsrNotices;
  route: PublicSsrRoutePayload;
  /** Complete slot/crossing, capacity, forecast, weather, tide, and vessel data. */
  schedule: GetScheduleResponse;
  nextSchedule: GetScheduleResponse;
  wsf: WSFStatus;
  bulletins: readonly Bulletin[];
  cameraFrames: PublicSsrCameraFrameStatusEnvelope;
  fares: FareCurrentCatalogResponse | FareNoFareResponse;
  vessels: readonly PublicSsrVessel[];
  alertGuidance: PublicSsrAlertGuidance;
  leaderboardIndex: PublicSsrLeaderboardIndex;
  leaderboard: PublicSsrLeaderboard;
}
/** Sources for which a canonical public empty value is meaningful. */
export interface PublicSsrEmptyPayloadMap {
  bulletins: readonly Bulletin[];
  cameraFrames: PublicSsrCameraFrameStatusEnvelope;
  leaderboard: PublicSsrLeaderboard;
  leaderboardIndex: PublicSsrLeaderboardIndex;
  notices: PublicSsrNotices;
  terminals: readonly PublicSsrTerminalSummary[];
  vessels: readonly PublicSsrVessel[];
}
export const PUBLIC_SSR_EMPTY_DATA: PublicSsrEmptyPayloadMap & {
  readonly [K in Exclude<
    PublicSsrSourceKey,
    keyof PublicSsrEmptyPayloadMap
  >]?: undefined;
} = {
  terminals: [],
  notices: { announcements: [], maintenance: { enabled: false, message: "" } },
  bulletins: [],
  cameraFrames: { frames: {}, sourceUpdatedAt: null },
  vessels: [],
  leaderboardIndex: { defaultPeriod: "all", entities: [] },
  leaderboard: {
    entity: { id: "", kind: "system", label: "" },
    entityId: "",
    period: "all",
    ranks: [],
  },
} as const;
export type PublicSsrSourceOutcome<K extends PublicSsrSourceKey> =
  | {
      outcome: "value";
      observedAt: string;
      sourceUpdatedAt: string | null;
      value: PublicSsrPayloadMap[K];
    }
  | (K extends keyof PublicSsrEmptyPayloadMap
      ? {
          outcome: "empty";
          observedAt: string;
          sourceUpdatedAt: string | null;
          value: PublicSsrEmptyPayloadMap[K];
        }
      : never)
  | {
      outcome: "authoritatively-unavailable";
      observedAt: string;
      sourceUpdatedAt: string | null;
      reason: PublicSsrUnavailableReason;
    }
  | (K extends "nextSchedule" | "schedule" | "vessels"
      ? {
          outcome: "transiently-unavailable";
          observedAt: string;
          sourceUpdatedAt: null;
          reason: PublicSsrTransientUnavailableReason;
        }
      : never)
  | {
      outcome: "stale-usable";
      observedAt: string;
      sourceUpdatedAt: string;
      value: PublicSsrPayloadMap[K];
    };
export type PublicSsrSourcesFor<K extends PublicSsrSourceKey> = {
  readonly [Source in K]: PublicSsrSourceOutcome<Source>;
};
export type PublicSsrRouteSourceMap = {
  "unknown-public-path": never;
  home: "ad" | "terminals" | "features" | "notices";
  today: "route" | "schedule" | "nextSchedule" | "wsf" | "notices";
  callback: never;
  account: never;
  "ios-migration": never;
  tickets: "editorial" | "ticketGuidance";
  about: "editorial";
  admin: never;
  "leaderboards-settings": never;
  "leaderboards-unmatched": never;
  leaderboards: "features" | "notices" | "leaderboardIndex";
  "leaderboards-terminal": "features" | "notices" | "leaderboard";
  "leaderboards-vessel": "features" | "notices" | "leaderboard";
  "data-sources": "editorial";
  privacy: "editorial";
  forecasting: "editorial";
  "forecasting-explained": never;
  feedback: "editorial";
  "terminal-schedule":
    | "ad"
    | "route"
    | "schedule"
    | "nextSchedule"
    | "wsf"
    | "bulletins"
    | "notices";
  "mate-schedule":
    | "ad"
    | "route"
    | "schedule"
    | "nextSchedule"
    | "wsf"
    | "bulletins"
    | "notices";
  "terminal-cameras": "ad" | "route" | "cameraFrames" | "notices";
  "mate-cameras": "ad" | "route" | "cameraFrames" | "notices";
  "terminal-details": "ad" | "route" | "notices";
  "mate-details": "ad" | "route" | "notices";
  "terminal-fares": "ad" | "route" | "fares" | "notices";
  "mate-fares": "ad" | "route" | "fares" | "notices";
  "terminal-map": "route" | "vessels" | "notices";
  "mate-map": "route" | "vessels" | "notices";
  "terminal-alerts": "route" | "bulletins" | "notices";
  "mate-alerts": "route" | "bulletins" | "notices";
  "terminal-subscribe": "route" | "alertGuidance" | "notices";
  "mate-subscribe": "route" | "alertGuidance" | "notices";
};
export interface PublicSsrMetadata {
  canonicalPath: string;
  description: string;
  robots: "index,follow" | "noindex,follow";
  title: string;
}
export type PublicSsrSnapshot = {
  [Id in PublicSsrRouteId]: {
    canonicalHost: string;
    canonicalPath: string;
    hostProfile: "ferry.fyi" | "howmanyboats.today";
    indexability: "indexable" | "noindex";
    metadata: PublicSsrMetadata;
    normalizedUrl: { path: string; query: Readonly<Record<string, string>> };
    renderedAt: string;
    routeId: Id;
    routeParams: PublicSsrRouteParams;
    sources: PublicSsrSourcesFor<PublicSsrRouteSourceMap[Id]>;
    version: typeof PUBLIC_SSR_SNAPSHOT_VERSION;
  };
}[PublicSsrRouteId];
export type PublicSsrFarePayload = Extract<
  PublicSsrPayloadMap["fares"],
  FareCurrentCatalogResponse | FareNoFareResponse
>;
