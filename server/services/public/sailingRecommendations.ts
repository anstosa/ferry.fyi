import { isGooglePlaceId } from "shared/contracts/addressSuggestions";
import type {
  SailingRecommendationRequest,
  SailingRecommendationResponse,
  TravelMode,
} from "shared/contracts/sailingRecommendations";
import type { Schedule } from "shared/contracts/schedules";
import { isRecommendationDirection } from "shared/data/boardingRules";
import { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";
import {
  getCapacityWatermark,
  getRecommendationServiceDate,
  getSailingRecommendationRevision,
} from "shared/lib/sailingRecommendationRevision";

import type { FillTimingObservation } from "../../lib/fillTiming";
import type {
  GoogleRouteDestination,
  GoogleRouteResult,
} from "../../lib/googleRoutes";
import logger from "../../lib/logger";
import { createTravelUncertainty } from "../../lib/sailingChance";
import {
  buildRecommendationBands,
  buildSailingAssessments,
} from "../../lib/sailingRecommendations";
import { terminalLocationService } from "../../lib/terminalLocations";

const MODES: TravelMode[] = ["drive", "walk", "bicycle", "transit"];
const REQUEST_KEYS = [
  "arrivingTerminalId",
  "bufferMinutes",
  "departingTerminalId",
  "mode",
  "origin",
];

// accept only a bounded request with no destination override
export const parseSailingRecommendationRequest = (
  value: unknown
): SailingRecommendationRequest | null => {
  // reject non-object payloads
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  // enforce exact top-level keys and domestic route identity
  if (
    Object.keys(input).length !== REQUEST_KEYS.length ||
    Object.keys(input).some((key) => !REQUEST_KEYS.includes(key)) ||
    typeof input.departingTerminalId !== "string" ||
    typeof input.arrivingTerminalId !== "string" ||
    !isRecommendationDirection(
      input.departingTerminalId,
      input.arrivingTerminalId
    ) ||
    !MODES.includes(input.mode as TravelMode) ||
    !Number.isInteger(input.bufferMinutes) ||
    Number(input.bufferMinutes) < 0 ||
    Number(input.bufferMinutes) > 60 ||
    !input.origin ||
    typeof input.origin !== "object" ||
    Array.isArray(input.origin)
  ) {
    return null;
  }
  const origin = input.origin as Record<string, unknown>;
  let normalizedOrigin: SailingRecommendationRequest["origin"];
  // constrain coordinate origins to the pacific northwest
  if (origin.kind === "coordinates") {
    // reject extra fields and non-finite/out-of-region fixes
    if (
      Object.keys(origin).sort().join(",") !== "kind,latitude,longitude" ||
      typeof origin.latitude !== "number" ||
      typeof origin.longitude !== "number" ||
      !Number.isFinite(origin.latitude) ||
      !Number.isFinite(origin.longitude) ||
      origin.latitude < 45 ||
      origin.latitude > 50 ||
      origin.longitude < -125 ||
      origin.longitude > -119
    ) {
      return null;
    }
    normalizedOrigin = {
      kind: "coordinates",
      latitude: origin.latitude,
      longitude: origin.longitude,
    };
  } else if (origin.kind === "address") {
    // discard invalid or unexpectedly extended manual origins
    if (
      Object.keys(origin).sort().join(",") !== "address,kind" ||
      typeof origin.address !== "string" ||
      origin.address.trim().length === 0 ||
      origin.address.length > 200 ||
      Array.from(origin.address).some((character) => {
        // forbid embedded control bytes in manual origins
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      return null;
    }
    normalizedOrigin = { kind: "address", address: origin.address.trim() };
  } else if (origin.kind === "place") {
    // accept only the selected opaque place identifier without display text
    if (
      Object.keys(origin).sort().join(",") !== "kind,placeId" ||
      !isGooglePlaceId(origin.placeId)
    ) {
      return null;
    }
    normalizedOrigin = { kind: "place", placeId: origin.placeId };
  } else {
    return null;
  }
  return {
    arrivingTerminalId: input.arrivingTerminalId,
    bufferMinutes: input.bufferMinutes as number,
    departingTerminalId: input.departingTerminalId,
    mode: input.mode as TravelMode,
    origin: normalizedOrigin,
  };
};

// admit calls synchronously before any provider work across this process
export const createRecommendationCallLimiter = (
  now: () => number = () => Date.now() / 1000
): (() => boolean) => {
  let tokens = 30;
  let previous = now();
  // refill a bounded thirty-call-per-minute bucket
  return () => {
    const time = now();
    tokens = Math.min(30, tokens + Math.max(0, time - previous) / 2);
    previous = time;
    // fail closed when the local provider budget is exhausted
    if (tokens < 1) {
      return false;
    }
    tokens -= 1;
    return true;
  };
};

export interface SailingRecommendationTelemetry {
  event: "sailing_recommendation";
  schemaVersion: 1;
  mode: TravelMode;
  sku: "compute_routes_pro" | "compute_routes_essentials";
  result: SailingRecommendationResponse["outcome"]["result"];
  reason: SailingRecommendationResponse["outcome"]["reason"] | null;
  capacityState: string | null;
  priorKind: "departure-point" | "zero-prior" | "live-only" | null;
  confidence: "low" | "medium" | null;
  modelVersion: "fill-linear-v1" | null;
  providerOutcome: "not-called" | "success" | "failure";
  providerLatencyMs: number | null;
  failureStage:
    | "configuration"
    | "schedule"
    | "provider"
    | "observations"
    | "selection"
    | null;
}

export interface SailingRecommendationDependencies {
  telemetry?: (event: SailingRecommendationTelemetry) => void;
  admitCall?: () => boolean;
  enabled?: () => boolean;
  getAccessPoint?: (
    id: string,
    mode: TravelMode
  ) => GoogleRouteDestination | null | Promise<GoogleRouteDestination | null>;
  getObservations?: (input: {
    arrivalId: string;
    departureId: string;
    departureTimes: number[];
    asOf: number;
  }) => Promise<FillTimingObservation[]>;
  getRoute?: (
    request: SailingRecommendationRequest,
    destination: GoogleRouteDestination
  ) => Promise<GoogleRouteResult>;
  getSchedule?: (
    departureId: string,
    arrivalId: string,
    date: string
  ) => Schedule | null;
  now?: () => number;
}

const defaultAdmitCall = createRecommendationCallLimiter();

// compose one route call with causal schedule and inventory snapshots
export const createSailingRecommendationService = (
  dependencies: SailingRecommendationDependencies = {}
) => {
  const now = dependencies.now ?? (() => Date.now() / 1000);
  const enabled =
    dependencies.enabled ??
    (() =>
      process.env.GOOGLE_ROUTES_ENABLED === "true" &&
      Boolean(process.env.GOOGLE_ROUTES_API_KEY));
  const getAccessPoint =
    dependencies.getAccessPoint ??
    // use the owner-configured booth for every travel method
    ((id: string) => terminalLocationService.getBooth(id));
  // resolve the existing synchronous schedule cache lazily
  const readSchedule = async (
    departureId: string,
    arrivalId: string,
    date: string
  ): Promise<Schedule | null> => {
    // use injected public snapshot fixtures
    if (dependencies.getSchedule) {
      return dependencies.getSchedule(departureId, arrivalId, date);
    }
    const { Schedule: Model } = await import("~/models/Schedule");
    return (
      Model.getByIndex(
        Model.generateKey(departureId, arrivalId, date)
      )?.serialize() ?? null
    );
  };
  // expose a stateless recommendation operation
  return async (
    request: SailingRecommendationRequest
  ): Promise<SailingRecommendationResponse> => {
    const requestedAt = now();
    let stage: SailingRecommendationTelemetry["failureStage"] = "configuration";
    let failureStage: SailingRecommendationTelemetry["failureStage"] = null;
    let providerOutcome: SailingRecommendationTelemetry["providerOutcome"] =
      "not-called";
    let providerLatencyMs: number | null = null;
    // emit only fixed summary fields with no request-bearing error metadata
    const finish = (
      response: SailingRecommendationResponse
    ): SailingRecommendationResponse => {
      const capacity = response.outcome.sailing?.capacity;
      const event: SailingRecommendationTelemetry = {
        event: "sailing_recommendation",
        schemaVersion: 1,
        mode: request.mode,
        sku:
          request.mode === "drive"
            ? "compute_routes_pro"
            : "compute_routes_essentials",
        result: response.outcome.result,
        reason: response.outcome.reason ?? null,
        capacityState: capacity?.state ?? null,
        priorKind: capacity?.priorKind ?? null,
        confidence: capacity?.confidence ?? null,
        modelVersion: capacity?.modelVersion ?? null,
        providerOutcome,
        providerLatencyMs,
        failureStage,
      };
      try {
        // diagnostics must not change recommendation availability
        if (dependencies.telemetry) {
          dependencies.telemetry(event);
        } else if (failureStage) {
          logger.warn("Sailing recommendation failed", event);
        } else {
          logger.info("Sailing recommendation result", event);
        }
      } catch {
        // keep an unavailable diagnostic sink isolated from the feature
      }
      return response;
    };
    // keep the disabled feature free of provider/database work
    if (!enabled()) {
      return finish(
        unavailableRecommendation(
          request.mode,
          "configuration-unavailable",
          requestedAt
        )
      );
    }
    try {
      const destination = await getAccessPoint(
        request.departingTerminalId,
        request.mode
      );
      // never substitute a dock or generic terminal center for the booth
      if (!destination) {
        return finish(
          unavailableRecommendation(
            request.mode,
            "configuration-unavailable",
            requestedAt
          )
        );
      }
      stage = "schedule";
      const date = getRecommendationServiceDate(requestedAt);
      const initialSchedule = await readSchedule(
        request.departingTerminalId,
        request.arrivingTerminalId,
        date
      );
      // avoid paid calls when the selected schedule is unavailable
      if (!initialSchedule || initialSchedule.slots.length === 0) {
        return finish(
          unavailableRecommendation(
            request.mode,
            "schedule-unavailable",
            requestedAt
          )
        );
      }
      // bound aggregate local provider admission before opening usage
      if (!(dependencies.admitCall ?? defaultAdmitCall)()) {
        return finish(
          unavailableRecommendation(
            request.mode,
            "provider-quota-unavailable",
            requestedAt
          )
        );
      }
      // instantiate the protected provider and usage ledger only when needed
      const getRoute =
        dependencies.getRoute ??
        (async (
          input: SailingRecommendationRequest,
          point: GoogleRouteDestination
        ) => {
          const { createGoogleRoutesAdapter } =
            await import("../../lib/googleRoutes");
          const { googleRoutesUsage } =
            await import("../../lib/googleRoutesUsage");
          return createGoogleRoutesAdapter({
            apiKey: process.env.GOOGLE_ROUTES_API_KEY ?? "",
            usage: googleRoutesUsage,
          }).getGoogleRoute(input, point);
        });
      stage = "provider";
      const providerStartedAt = now();
      const route = await getRoute(request, destination);
      providerLatencyMs = Math.max(0, (now() - providerStartedAt) * 1000);
      providerOutcome = route.ok ? "success" : "failure";
      // discard any unusable provider output before selection
      if (!route.ok) {
        return finish(
          unavailableRecommendation(request.mode, route.reason, now())
        );
      }
      stage = "schedule";
      const snapshotDate = getRecommendationServiceDate(now());
      const schedule = await readSchedule(
        request.departingTerminalId,
        request.arrivingTerminalId,
        snapshotDate
      );
      const asOf = now();
      // reject a service-day rollover rather than join two dates
      if (
        !schedule ||
        schedule.date !== date ||
        getRecommendationServiceDate(asOf) !== date
      ) {
        return finish(
          unavailableRecommendation(request.mode, "schedule-unavailable", asOf)
        );
      }
      const revision = getSailingRecommendationRevision(schedule);
      const readObservations =
        dependencies.getObservations ??
        (async (input: {
          arrivalId: string;
          departureId: string;
          departureTimes: number[];
          asOf: number;
        }) => {
          const { readCapacityObservations } =
            await import("../../lib/capacityObservations");
          return readCapacityObservations(input);
        });
      stage = "observations";
      const observations =
        request.mode === "drive"
          ? await readObservations({
              arrivalId: request.arrivingTerminalId,
              departureId: request.departingTerminalId,
              departureTimes: schedule.slots.map((slot) => slot.time),
              asOf,
            })
          : [];
      const currentSchedule = await readSchedule(
        request.departingTerminalId,
        request.arrivingTerminalId,
        date
      );
      // discard snapshots changed during the observation read
      if (
        !currentSchedule ||
        getSailingRecommendationRevision(currentSchedule) !== revision
      ) {
        return finish(
          unavailableRecommendation(request.mode, "stale-result", now())
        );
      }
      stage = "selection";
      const arrivalAt =
        route.value.routeRequestedAt + route.value.durationSeconds;
      const bands = buildRecommendationBands({
        arrivalAt,
        asOf,
        mode: request.mode,
        observations,
        schedule,
      });
      const travelUncertainty = createTravelUncertainty({
        ...route.value,
        mode: request.mode,
      });
      const sailingAssessments = buildSailingAssessments({
        arrivalAt,
        asOf,
        bands,
        mode: request.mode,
        observations,
        schedule,
        travelUncertainty,
      });
      const includedSailings = [
        ...bands.map((band) => band.outcome.sailing),
        ...sailingAssessments,
      ];
      const anchors = includedSailings.flatMap((sailing) => {
        // expire every displayed neighbor as well as the selected inventory anchor
        const anchor = sailing?.capacity?.anchorAt;
        return typeof anchor === "number" ? [anchor + 180] : [];
      });
      const validUntil = Math.min(
        route.value.routeRequestedAt + 120,
        ...anchors
      );
      const selected = bands.find(
        (band) =>
          request.bufferMinutes >= band.minimumBufferMinutes &&
          request.bufferMinutes <= band.maximumBufferMinutes
      );
      // never return expired bands or an uncovered buffer
      if (validUntil <= now() || !selected) {
        return finish(
          unavailableRecommendation(request.mode, "stale-result", now())
        );
      }
      const staticDurationSeconds = route.value.staticDurationSeconds ?? null;
      const trafficDelaySeconds =
        request.mode === "drive" &&
        route.value.trafficAware &&
        staticDurationSeconds !== null &&
        staticDurationSeconds > 0
          ? Math.max(0, route.value.durationSeconds - staticDurationSeconds)
          : null;
      let trafficLevel: SailingRecommendationResponse["trafficLevel"] = null;
      // use app-defined colors without requesting enterprise road-segment traffic
      if (trafficDelaySeconds !== null && staticDurationSeconds !== null) {
        const delayRatio = trafficDelaySeconds / staticDurationSeconds;
        // compare the current trip with its historical baseline
        if (trafficDelaySeconds < 120 || delayRatio < 0.15) {
          trafficLevel = "light";
        } else if (trafficDelaySeconds < 600 && delayRatio < 0.4) {
          // distinguish moderate delay from a substantial slowdown
          trafficLevel = "moderate";
        } else {
          trafficLevel = "heavy";
        }
      }
      return finish({
        arrivalAt,
        attribution: "Google Maps",
        bufferOutcomeBands: bands,
        capacityWatermark: getCapacityWatermark(schedule),
        durationSeconds: route.value.durationSeconds,
        mode: request.mode,
        outcome: selected.outcome,
        partialMatch: route.value.partialMatch,
        recommendationAsOf: asOf,
        revision,
        routeRequestedAt: route.value.routeRequestedAt,
        source: "google-routes",
        sailingAssessments,
        staticDurationSeconds,
        trafficAware: route.value.trafficAware,
        trafficDelaySeconds,
        trafficLevel,
        travelUncertainty,
        validUntil,
        warnings: route.value.warnings,
      });
    } catch {
      // classify internal stage without forwarding raw exceptions
      failureStage = stage;
      providerOutcome = stage === "provider" ? "failure" : providerOutcome;
      let reason:
        | "schedule-unavailable"
        | "provider-unavailable"
        | "configuration-unavailable" = "schedule-unavailable";
      // distinguish provider failure from an unavailable configured booth
      if (stage === "provider") {
        reason = "provider-unavailable";
      } else if (stage === "configuration") {
        reason = "configuration-unavailable";
      }
      return finish(unavailableRecommendation(request.mode, reason, now()));
    }
  };
};

export { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";
