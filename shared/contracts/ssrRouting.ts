/** Route policy types intentionally contain no runtime or library dependencies. */
export type PublicSsrRouteKind =
  | "static"
  | "dynamic"
  | "private"
  | "redirect"
  | "not-found";
export type PublicSsrRouteId =
  | "home"
  | "today"
  | "callback"
  | "account"
  | "ios-migration"
  | "tickets"
  | "about"
  | "admin"
  | "leaderboards"
  | "leaderboards-settings"
  | "leaderboards-terminal"
  | "leaderboards-vessel"
  | "leaderboards-unmatched"
  | "data-sources"
  | "privacy"
  | "forecasting"
  | "forecasting-explained"
  | "feedback"
  | "terminal-schedule"
  | "terminal-cameras"
  | "terminal-details"
  | "terminal-fares"
  | "terminal-map"
  | "terminal-alerts"
  | "terminal-subscribe"
  | "mate-schedule"
  | "mate-cameras"
  | "mate-details"
  | "mate-fares"
  | "mate-map"
  | "mate-alerts"
  | "mate-subscribe"
  | "unknown-public-path";

export type PublicSsrQueryName =
  | "date"
  | "fareMode"
  | "fareVehicle"
  | "fareAdults"
  | "fareChildren"
  | "fareSeniors"
  | "fareDriver"
  | "fareLength";
export type PublicSsrSourceKey =
  | "ad"
  | "terminals"
  | "features"
  | "editorial"
  | "ticketGuidance"
  | "notices"
  | "route"
  | "schedule"
  | "nextSchedule"
  | "wsf"
  | "bulletins"
  | "cameraFrames"
  | "fares"
  | "vessels"
  | "alertGuidance"
  | "leaderboardIndex"
  | "leaderboard";
export type PublicSsrIndexabilityPolicy =
  | "seo"
  | "seo-and-public-leaderboards"
  | "noindex";
export type PublicSsrLoader =
  | "none"
  | "editorial"
  | "home"
  | "today"
  | "leaderboards"
  | "terminal"
  | "route";
export type PublicSsrPlaceholder = "none" | "anonymous" | "client-only";
export type PublicSsrRefresh =
  | "none"
  | "public-content"
  | "schedule"
  | "route"
  | "leaderboards";
export type PublicSsrView =
  | "schedule"
  | "cameras"
  | "terminal"
  | "fare"
  | "map"
  | "alerts"
  | "subscribe";
export type PublicSsrRouteParams = Partial<
  Record<"terminalSlug" | "mateSlug" | "terminalId" | "vesselId", string>
>;

export interface PublicSsrRouteDefinition {
  allowedQuery: readonly PublicSsrQueryName[];
  boundaryLabel: string;
  browserMount?: boolean;
  id: PublicSsrRouteId;
  indexabilityPolicy: PublicSsrIndexabilityPolicy;
  kind: PublicSsrRouteKind;
  loader: PublicSsrLoader;
  path: string;
  placeholder: PublicSsrPlaceholder;
  refresh: PublicSsrRefresh;
  requiredSources: readonly PublicSsrSourceKey[];
  redirectTo?: string;
  view?: PublicSsrView;
}
