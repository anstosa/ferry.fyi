export type PublicApiAuthClass = "bearer" | "public" | "sensitive-id";
export type PublicApiCacheClass = "live-no-store" | "private-no-store";
export type PublicApiRateClass =
  | "anonymous-read"
  | "authenticated"
  | "sensitive-lookup"
  | "upstream-refresh";

export interface PublicApiOperation {
  advertiseInLlms: boolean;
  auth: PublicApiAuthClass;
  cache: PublicApiCacheClass;
  documentInDataSources: boolean;
  featureGate?: "leaderboards";
  freshness: string;
  includeInOpenApi: boolean;
  method: "GET" | "POST";
  operationId: string;
  path: string;
  rate: PublicApiRateClass;
  responseClass: "collection" | "resource" | "status";
  summary: string;
}

export const publicApiOperations = [
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Terminal and bulletin fields include upstream observation context when available.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "listTerminals",
    path: "/api/terminals",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "List ferry terminals",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness:
      "Live terminal context; callers must retain timestamps and WSF status.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getTerminal",
    path: "/api/terminals/{terminalId}",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Get one ferry terminal",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness: "Returns the latest known bulletin source timestamp.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getBulletinFreshness",
    path: "/api/terminals/bulletins/freshness",
    rate: "anonymous-read",
    responseClass: "status",
    summary: "Get bulletin freshness",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness:
      "Live schedule; observed and predictive fields must remain distinguished.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getCurrentSchedule",
    path: "/api/schedule/{departingId}/{arrivingId}",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Get today's directional schedule",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Live schedule; observed and predictive fields must remain distinguished.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getDatedSchedule",
    path: "/api/schedule/{departingId}/{arrivingId}/{date}",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Get a dated directional schedule",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Vessel status is live and can become unavailable between observations.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "listVessels",
    path: "/api/vessels",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "List vessels",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness:
      "Includes sourceUpdatedAt for the oldest represented vessel observation.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getVesselSnapshot",
    path: "/api/vessels/snapshot",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "Get the live vessel snapshot",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness:
      "Live vessel context; callers must retain timestamps and WSF status.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getVessel",
    path: "/api/vessels/{vesselId}",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Get one vessel",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Camera metadata is observational and may be stale or unavailable.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getCameraFrames",
    path: "/api/cameras/frames",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "Get camera-frame metadata",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness:
      "Line detection is observational and must not be presented as exact queue length.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getCameraLineDetection",
    path: "/api/cameras/line-detection",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "Get public camera line-detection summaries",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Fare state and freshness fields determine whether values are current.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getFareCatalog",
    path: "/api/fares/catalog",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Get a fare catalog",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: true,
    freshness:
      "Fare state and freshness fields determine whether values are current.",
    includeInOpenApi: true,
    method: "POST",
    operationId: "quoteFare",
    path: "/api/fares/quote",
    rate: "anonymous-read",
    responseClass: "resource",
    summary: "Quote selected fare items",
  },
  {
    advertiseInLlms: true,
    auth: "bearer",
    cache: "private-no-store",
    documentInDataSources: false,
    freshness:
      "Private account state; never cache or disclose across subjects.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getCurrentUser",
    path: "/api/user",
    rate: "authenticated",
    responseClass: "resource",
    summary: "Get current user settings",
  },
  {
    advertiseInLlms: true,
    auth: "bearer",
    cache: "private-no-store",
    documentInDataSources: false,
    freshness:
      "Private account state; never cache or disclose across subjects.",
    includeInOpenApi: true,
    method: "POST",
    operationId: "updateCurrentUser",
    path: "/api/user",
    rate: "authenticated",
    responseClass: "resource",
    summary: "Update current user settings",
  },
  {
    advertiseInLlms: true,
    auth: "sensitive-id",
    cache: "private-no-store",
    documentInDataSources: false,
    freshness:
      "Sensitive holder-supplied lookup; optional bearer authentication enables a 30-minute account-scoped latest-result cache, while anonymous results are not persisted.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getTicket",
    path: "/api/tickets/{ticketId}",
    rate: "sensitive-lookup",
    responseClass: "resource",
    summary: "Look up a supplied ticket identifier",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    featureGate: "leaderboards",
    freshness:
      "Feature-gated, sanitized public ranking; disabled state is 404.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getTerminalLeaderboard",
    path: "/api/leaderboards/terminals/{terminalId}",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "Get a public terminal leaderboard",
  },
  {
    advertiseInLlms: true,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    featureGate: "leaderboards",
    freshness:
      "Feature-gated, sanitized public ranking; disabled state is 404.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getVesselLeaderboard",
    path: "/api/leaderboards/vessels/{vesselId}",
    rate: "anonymous-read",
    responseClass: "collection",
    summary: "Get a public vessel leaderboard",
  },
  {
    advertiseInLlms: false,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness: "Global public feature status.",
    includeInOpenApi: true,
    method: "GET",
    operationId: "getPublicFeatures",
    path: "/api/features",
    rate: "anonymous-read",
    responseClass: "status",
    summary: "Get public feature flags",
  },
  {
    advertiseInLlms: false,
    auth: "public",
    cache: "live-no-store",
    documentInDataSources: false,
    freshness: "Operational refresh that can call an upstream source.",
    includeInOpenApi: false,
    method: "POST",
    operationId: "refreshVesselsInternal",
    path: "/api/vessels/refresh",
    rate: "upstream-refresh",
    responseClass: "status",
    summary: "Internal vessel refresh",
  },
] as const satisfies readonly PublicApiOperation[];

export const advertisedPublicApiOperations = publicApiOperations.filter(
  ({ advertiseInLlms }) => advertiseInLlms
);
export const dataSourcesPublicApiOperations = publicApiOperations.filter(
  ({ documentInDataSources }) => documentInDataSources
);
export const openApiOperations = publicApiOperations.filter(
  ({ includeInOpenApi }) => includeInOpenApi
);
