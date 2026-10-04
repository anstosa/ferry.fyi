import { isGooglePlaceId } from "shared/contracts/addressSuggestions";
import type {
  RecommendationFailureReason,
  RecommendationOrigin,
  TravelMode,
} from "shared/contracts/sailingRecommendations";

import type {
  GoogleRoutesSku,
  GoogleRoutesUsageHandle,
} from "~/lib/googleRoutesUsage";

export const GOOGLE_ROUTES_ENDPOINT =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
export const GOOGLE_ROUTES_TIMEOUT_MS = 2_500;

const BASE_FIELD_MASK = [
  "routes.duration",
  "routes.staticDuration",
  "routes.warnings",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.navigationInstruction.maneuver",
  "routes.legs.steps.transitDetails.transitLine.vehicle.type",
  "fallbackInfo.routingMode",
  "fallbackInfo.reason",
].join(",");
const ADDRESS_FIELD_MASK = [
  "geocodingResults.origin.geocoderStatus",
  "geocodingResults.origin.partialMatch",
  "geocodingResults.origin.placeId",
].join(",");

export interface GoogleRouteDestination {
  latitude: number;
  longitude: number;
}

export interface GoogleRouteRequest {
  mode: TravelMode;
  origin: RecommendationOrigin;
}

export interface GoogleRouteSuccess {
  durationSeconds: number;
  partialMatch: boolean;
  routeRequestedAt: number;
  staticDurationSeconds?: number | null;
  trafficAware: boolean;
  warnings: string[];
}

export type GoogleRouteResult =
  | { ok: true; value: GoogleRouteSuccess }
  | { ok: false; reason: RecommendationFailureReason };

export interface GoogleRoutesUsageRecorder {
  /** Opens the immutable billing-month handle before provider I/O. */
  open(sku: GoogleRoutesSku, at: Date): Promise<GoogleRoutesUsageHandle>;
  /** Marks a received provider response without logging request contents. */
  complete(
    handle: GoogleRoutesUsageHandle,
    outcome: "known-failure" | "success"
  ): Promise<void>;
}

export interface GoogleRoutesAdapterDependencies {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  usage?: GoogleRoutesUsageRecorder;
}

interface GoogleRouteStep {
  navigationInstruction?: { maneuver?: string };
  transitDetails?: { transitLine?: { vehicle?: { type?: string } } };
  travelMode?: string;
}

interface GoogleRouteCandidate {
  duration?: string;
  legs?: { steps?: GoogleRouteStep[] }[];
  staticDuration?: string;
  warnings?: unknown[];
}

interface GoogleRoutesResponse {
  fallbackInfo?: { reason?: string; routingMode?: string };
  geocodingResults?: {
    origin?: {
      geocoderStatus?: Record<string, unknown> | string;
      partialMatch?: boolean;
      placeId?: string;
    };
  };
  routes?: GoogleRouteCandidate[];
}

const NOOP_USAGE: GoogleRoutesUsageRecorder = {
  // keep provider tests and explicitly unmetered callers deterministic
  complete: () => Promise.resolve(),
  // preserve the same immutable handle shape
  open: (sku, at) => Promise.resolve({ month: getPacificMonth(at), sku }),
};

/** Returns the Pacific billing month without changing the captured instant. */
function getPacificMonth(at: Date): string {
  // use Google's documented Pacific monthly reset boundary
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

/** Maps the selected rider mode to the billed request class. */
export function classifyGoogleRoutesSku(mode: TravelMode): GoogleRoutesSku {
  // traffic-aware driving is the only supported pro trigger
  if (mode === "drive") {
    return "compute_routes_pro";
  }
  return "compute_routes_essentials";
}

// build one allowlisted compute routes body
function buildRequestBody(
  request: GoogleRouteRequest,
  destination: GoogleRouteDestination
): Record<string, unknown> {
  let origin: Record<string, unknown>;
  // preserve manual, selected-place and coordinate representations separately
  if (request.origin.kind === "address") {
    origin = { address: request.origin.address };
  } else if (request.origin.kind === "place") {
    // use google's preferred exact place representation for autocomplete selections
    origin = { placeId: request.origin.placeId };
  } else {
    // encode only the explicit foreground coordinate fix
    origin = {
      location: {
        latLng: {
          latitude: request.origin.latitude,
          longitude: request.origin.longitude,
        },
      },
    };
  }
  const body: Record<string, unknown> = {
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    origin,
    travelMode: request.mode.toUpperCase(),
  };

  // request only Google's supported driving preferences
  if (request.mode === "drive") {
    body.routingPreference = "TRAFFIC_AWARE";
    body.routeModifiers = { avoidFerries: true };
  } else {
    // request same-call alternatives where ferry avoidance is unavailable
    body.computeAlternativeRoutes = true;
  }

  // bias manual geocoding to the supported country
  if (request.origin.kind === "address") {
    body.regionCode = "us";
  }
  return body;
}

// validate data before opening any paid provider request
function isValidRequest(
  request: GoogleRouteRequest,
  destination: GoogleRouteDestination
): boolean {
  // reject invalid access coordinates
  if (
    !Number.isFinite(destination.latitude) ||
    !Number.isFinite(destination.longitude) ||
    destination.latitude < -90 ||
    destination.latitude > 90 ||
    destination.longitude < -180 ||
    destination.longitude > 180
  ) {
    return false;
  }
  // validate the selected origin representation
  if (request.origin.kind === "address") {
    return request.origin.address.trim().length > 0;
  }
  // preserve the exact selected google origin without re-geocoding display text
  if (request.origin.kind === "place") {
    return isGooglePlaceId(request.origin.placeId);
  }
  return (
    Number.isFinite(request.origin.latitude) &&
    Number.isFinite(request.origin.longitude) &&
    request.origin.latitude >= -90 &&
    request.origin.latitude <= 90 &&
    request.origin.longitude >= -180 &&
    request.origin.longitude <= 180
  );
}

/** Rejects routes that include or cannot rule out ferry recursion. */
function isLandOnlyRoute(
  route: GoogleRouteCandidate,
  mode: TravelMode
): boolean {
  const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  // reject missing ferry-detection evidence rather than trusting duration alone
  if (
    steps.length === 0 ||
    (mode === "transit" && !steps.some((step) => step.travelMode === "TRANSIT"))
  ) {
    return false;
  }
  // inspect every returned typed step
  for (const step of steps) {
    const maneuver = step.navigationInstruction?.maneuver;
    // reject positive non-transit ferry evidence
    if (maneuver === "FERRY" || maneuver === "FERRY_TRAIN") {
      return false;
    }
    // fail closed on ambiguous transit vehicle classifications
    if (step.travelMode === "TRANSIT") {
      const vehicleType = step.transitDetails?.transitLine?.vehicle?.type;
      if (
        !vehicleType ||
        vehicleType === "FERRY" ||
        vehicleType === "OTHER" ||
        vehicleType === "TRANSIT_VEHICLE_TYPE_UNSPECIFIED"
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Parses Google's protobuf-duration JSON encoding conservatively. */
function parseDurationSeconds(duration: unknown): number | null {
  // accept only finite, nonnegative protobuf durations
  if (typeof duration !== "string" || !/^\d+(?:\.\d+)?s$/.test(duration)) {
    return null;
  }
  const seconds = Number(duration.slice(0, -1));
  return Number.isFinite(seconds) ? Math.ceil(seconds) : null;
}

/** Determines whether a manual origin was resolved completely. */
function isUsableManualOrigin(response: GoogleRoutesResponse): boolean {
  const origin = response.geocodingResults?.origin;
  // reject a partial match even when Google also returns a route
  if (!origin || origin.partialMatch === true) {
    return false;
  }
  const status = origin.geocoderStatus;
  // tolerate Google's empty OK status object and explicit OK string
  return (
    status === "OK" ||
    (typeof status === "object" &&
      status !== null &&
      (status.code === undefined || status.code === 0))
  );
}

/** normalizes a provider payload without retaining place ids or raw bodies */
function normalizeResponse(
  request: GoogleRouteRequest,
  response: GoogleRoutesResponse,
  routeRequestedAt: number
): GoogleRouteResult {
  // require a complete manual geocode
  if (request.origin.kind === "address" && !isUsableManualOrigin(response)) {
    return { ok: false, reason: "origin-needs-correction" };
  }
  const routes = Array.isArray(response.routes) ? response.routes : [];
  // distinguish no route from ferry-only alternatives
  if (routes.length === 0) {
    return { ok: false, reason: "no-route" };
  }
  const route = routes.find((route) => {
    // retain only same-mode alternatives with typed land-travel evidence
    return isLandOnlyRoute(route, request.mode);
  });
  // refuse recursive or ambiguous ferry travel
  if (!route) {
    return { ok: false, reason: "ferry-route-recursion" };
  }
  const durationSeconds = parseDurationSeconds(route.duration);
  // normalize malformed success payloads without exposing internals
  if (durationSeconds === null) {
    return { ok: false, reason: "provider-unavailable" };
  }
  const warnings = Array.isArray(route.warnings)
    ? route.warnings.filter(
        (warning): warning is string => typeof warning === "string"
      )
    : [];
  const fallbackMode = response.fallbackInfo?.routingMode;
  const trafficAware =
    request.mode === "drive" &&
    fallbackMode !== "TRAFFIC_UNAWARE" &&
    fallbackMode !== "FALLBACK_TRAFFIC_UNAWARE";
  return {
    ok: true,
    value: {
      durationSeconds,
      partialMatch: false,
      routeRequestedAt,
      staticDurationSeconds: parseDurationSeconds(route.staticDuration),
      trafficAware,
      warnings,
    },
  };
}

/** Creates the fixed-host, no-retry Google Routes adapter. */
export function createGoogleRoutesAdapter(
  dependencies: GoogleRoutesAdapterDependencies
): {
  getGoogleRoute(
    request: GoogleRouteRequest,
    destination: GoogleRouteDestination
  ): Promise<GoogleRouteResult>;
} {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const usage = dependencies.usage ?? NOOP_USAGE;

  return {
    // perform exactly one paid call after local validation
    async getGoogleRoute(request, destination) {
      // fail closed before accounting or network I/O
      if (!dependencies.apiKey || !isValidRequest(request, destination)) {
        return {
          ok: false,
          reason: dependencies.apiKey
            ? "invalid-request"
            : "configuration-unavailable",
        };
      }
      const requestedAt = now();
      let usageHandle: GoogleRoutesUsageHandle;
      // require the attempt to be durably opened before network I/O
      try {
        usageHandle = await usage.open(
          classifyGoogleRoutesSku(request.mode),
          requestedAt
        );
      } catch {
        return { ok: false, reason: "provider-unavailable" };
      }
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        GOOGLE_ROUTES_TIMEOUT_MS
      );
      let providerResponse: Response;
      // capture the leave-now clock after durable accounting and immediately before fetch
      const routeRequestedAt = now().getTime() / 1_000;
      // bound the one provider call without retrying
      try {
        providerResponse = await fetchImpl(GOOGLE_ROUTES_ENDPOINT, {
          body: JSON.stringify(buildRequestBody(request, destination)),
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": dependencies.apiKey,
            "X-Goog-FieldMask":
              request.origin.kind === "address"
                ? `${BASE_FIELD_MASK},${ADDRESS_FIELD_MASK}`
                : BASE_FIELD_MASK,
          },
          method: "POST",
          signal: abortController.signal,
        });
      } catch {
        clearTimeout(timeout);
        return {
          ok: false,
          reason: abortController.signal.aborted
            ? "provider-timeout"
            : "provider-unavailable",
        };
      }

      // record all received non-success responses as known failures
      if (!providerResponse.ok) {
        clearTimeout(timeout);
        // fail closed if the known-failure transition cannot be persisted
        try {
          await usage.complete(usageHandle, "known-failure");
        } catch {
          return { ok: false, reason: "provider-unavailable" };
        }
        return {
          ok: false,
          reason:
            providerResponse.status === 429
              ? "provider-quota-unavailable"
              : "provider-unavailable",
        };
      }
      // every 2xx counts even when the body later proves malformed
      try {
        await usage.complete(usageHandle, "success");
      } catch {
        clearTimeout(timeout);
        return { ok: false, reason: "provider-unavailable" };
      }
      let payload: GoogleRoutesResponse;
      // normalize malformed JSON without exposing provider contents
      try {
        payload = (await providerResponse.json()) as GoogleRoutesResponse;
      } catch {
        return {
          ok: false,
          reason: abortController.signal.aborted
            ? "provider-timeout"
            : "provider-unavailable",
        };
      } finally {
        clearTimeout(timeout);
      }
      return normalizeResponse(request, payload, routeRequestedAt);
    },
  };
}
