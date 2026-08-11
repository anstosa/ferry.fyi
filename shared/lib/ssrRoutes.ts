import type {
  PublicSsrRouteDefinition,
  PublicSsrRouteId,
  PublicSsrSourceKey,
  PublicSsrView,
} from "../contracts/ssrRouting";
import type { SeoMetadata } from "./seo";

const define = (route: PublicSsrRouteDefinition) => route;
const sourceForView = (view: PublicSsrView): readonly PublicSsrSourceKey[] => {
  switch (view) {
    case "schedule":
      return [
        "ad",
        "route",
        "schedule",
        "nextSchedule",
        "wsf",
        "bulletins",
        "notices",
      ];
    case "cameras":
      return ["ad", "route", "cameraFrames", "notices"];
    case "terminal":
      return ["ad", "route", "notices"];
    case "fare":
      return ["ad", "route", "fares", "notices"];
    case "map":
      return ["route", "vessels", "notices"];
    case "alerts":
      return ["route", "bulletins", "notices"];
    case "subscribe":
      return ["route", "alertGuidance", "notices"];
  }
};
const label = (view: PublicSsrView) =>
  ({
    schedule: "Schedule",
    cameras: "Cameras",
    terminal: "Terminal",
    fare: "Fares",
    map: "Map",
    alerts: "Alerts",
    subscribe: "Alerts",
  })[view];
const part = (view: PublicSsrView) => {
  if (view === "terminal") {
    return "details";
  }
  return view === "fare" ? "fares" : view;
};
const allowedQuery = (view: PublicSsrView) => {
  if (view === "schedule") {
    return ["date"] as const;
  }
  // Fare selectors are browser-only interactive state. The public SSR fare
  // tree renders the same catalog summary for every selector combination, so
  // selectors must not create distinct snapshots or cache entries.
  return [];
};
const PUBLIC_SSR_VIEWS = [
  "schedule",
  "cameras",
  "terminal",
  "fare",
  "map",
  "alerts",
  "subscribe",
] as const satisfies readonly PublicSsrView[];

const dynamicTerminalRoutes = PUBLIC_SSR_VIEWS.flatMap((view) => {
  const suffix = view === "schedule" ? "" : `/${view}`;
  return [
    define({
      allowedQuery: allowedQuery(view),
      boundaryLabel: label(view),
      id: `terminal-${part(view)}` as PublicSsrRouteId,
      indexabilityPolicy: "seo",
      kind: "dynamic",
      loader: view === "terminal" ? "terminal" : "route",
      path: `/:terminalSlug${suffix}`,
      placeholder: "anonymous",
      refresh: view === "schedule" ? "schedule" : "route",
      requiredSources: sourceForView(view),
      view,
    }),
    define({
      allowedQuery: allowedQuery(view),
      boundaryLabel: label(view),
      id: `mate-${part(view)}` as PublicSsrRouteId,
      indexabilityPolicy: "seo",
      kind: "dynamic",
      loader: view === "terminal" ? "terminal" : "route",
      path: `/:terminalSlug/:mateSlug${suffix}`,
      placeholder: "anonymous",
      refresh: view === "schedule" ? "schedule" : "route",
      requiredSources: sourceForView(view),
      view,
    }),
  ];
});
const staticRoute = (
  id: PublicSsrRouteId,
  path: string,
  boundaryLabel: string,
  requiredSources: readonly PublicSsrSourceKey[] = ["editorial"]
) =>
  define({
    allowedQuery: [],
    boundaryLabel,
    id,
    indexabilityPolicy: "seo",
    kind: "static",
    loader: "editorial",
    path,
    placeholder: "none",
    refresh: "none",
    requiredSources,
  });
/** The sole wildcard policy: it never retains any requested path or query. */
const PUBLIC_SSR_UNKNOWN_PATH_POLICY = define({
  allowedQuery: [],
  boundaryLabel: "Not found",
  id: "unknown-public-path",
  indexabilityPolicy: "noindex",
  kind: "not-found",
  loader: "none",
  path: "*",
  placeholder: "none",
  refresh: "none",
  requiredSources: [],
});
export const PUBLIC_SSR_ROUTE_MANIFEST = [
  define({
    allowedQuery: [],
    boundaryLabel: "Home",
    id: "home",
    indexabilityPolicy: "seo",
    kind: "dynamic",
    loader: "home",
    path: "/",
    placeholder: "none",
    refresh: "public-content",
    requiredSources: ["ad", "terminals", "features", "notices"],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Today",
    id: "today",
    indexabilityPolicy: "seo",
    kind: "dynamic",
    loader: "today",
    path: "/today",
    placeholder: "none",
    refresh: "schedule",
    requiredSources: ["route", "schedule", "nextSchedule", "wsf", "notices"],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Callback",
    id: "callback",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/callback",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Account",
    id: "account",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/account",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "iOS account migration",
    id: "ios-migration",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/ios",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Log in",
    id: "login",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/login",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Log out",
    id: "logout",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/logout",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  staticRoute("tickets", "/tickets", "Tickets", [
    "editorial",
    "ticketGuidance",
  ]),
  staticRoute("about", "/about", "About"),
  define({
    allowedQuery: [],
    boundaryLabel: "Admin",
    id: "admin",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/admin",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Leaderboards",
    id: "leaderboards-settings",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/leaderboards/settings",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Leaderboards",
    id: "leaderboards",
    indexabilityPolicy: "seo-and-public-leaderboards",
    kind: "dynamic",
    loader: "leaderboards",
    path: "/leaderboards",
    placeholder: "anonymous",
    refresh: "leaderboards",
    requiredSources: ["features", "notices", "leaderboardIndex"],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Leaderboards",
    id: "leaderboards-terminal",
    indexabilityPolicy: "seo-and-public-leaderboards",
    kind: "dynamic",
    loader: "leaderboards",
    path: "/leaderboards/terminals/:terminalId",
    placeholder: "anonymous",
    refresh: "leaderboards",
    requiredSources: ["features", "notices", "leaderboard"],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Leaderboards",
    id: "leaderboards-vessel",
    indexabilityPolicy: "seo-and-public-leaderboards",
    kind: "dynamic",
    loader: "leaderboards",
    path: "/leaderboards/vessels/:vesselId",
    placeholder: "anonymous",
    refresh: "leaderboards",
    requiredSources: ["features", "notices", "leaderboard"],
  }),
  define({
    allowedQuery: [],
    boundaryLabel: "Leaderboards",
    browserMount: true,
    id: "leaderboards-unmatched",
    indexabilityPolicy: "noindex",
    kind: "private",
    loader: "none",
    path: "/leaderboards/*",
    placeholder: "client-only",
    refresh: "none",
    requiredSources: [],
  }),
  staticRoute("data-sources", "/data-sources", "Data sources and API guide"),
  staticRoute("privacy", "/privacy", "Privacy Policy"),
  staticRoute("forecasting", "/forecasting", "Forecasting"),
  define({
    allowedQuery: [],
    boundaryLabel: "Forecasting",
    id: "forecasting-explained",
    indexabilityPolicy: "noindex",
    kind: "redirect",
    loader: "none",
    path: "/forecasting-explained",
    placeholder: "none",
    refresh: "none",
    redirectTo: "/forecasting",
    requiredSources: [],
  }),
  staticRoute("feedback", "/feedback", "Feedback"),
  ...dynamicTerminalRoutes,
  PUBLIC_SSR_UNKNOWN_PATH_POLICY,
] as const satisfies readonly PublicSsrRouteDefinition[];
export const getPublicSsrRouteDefinition = (
  id: PublicSsrRouteId
): PublicSsrRouteDefinition => {
  const result = PUBLIC_SSR_ROUTE_MANIFEST.find((route) => route.id === id);
  if (!result) {
    throw new Error(`Unknown public SSR route: ${id}`);
  }
  return result;
};
export const resolvePublicSsrIndexability = (
  route: Pick<PublicSsrRouteDefinition, "indexabilityPolicy">,
  seo: Pick<SeoMetadata, "robots">,
  publicLeaderboardsEnabled = false
): "indexable" | "noindex" =>
  route.indexabilityPolicy === "noindex" ||
  (route.indexabilityPolicy === "seo-and-public-leaderboards" &&
    !publicLeaderboardsEnabled) ||
  seo.robots !== "index,follow"
    ? "noindex"
    : "indexable";
