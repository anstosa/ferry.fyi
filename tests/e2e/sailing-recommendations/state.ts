import { DateTime } from "luxon";
import type {
  SailingRecommendationRequest,
  SailingRecommendationResponse,
  TravelMode,
} from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { getSailingRecommendationRevision } from "shared/lib/sailingRecommendationRevision";

import type { FillTimingObservation } from "../../../server/lib/fillTiming";
import { createTravelUncertainty } from "../../../server/lib/sailingChance";
import {
  buildRecommendationBands,
  buildSailingAssessments,
} from "../../../server/lib/sailingRecommendations";

export type FixtureScenario =
  | "buffer-only-late"
  | "capacity-recovery"
  | "tied-repair"
  | "capacity-unavailable"
  | "denied"
  | "departed-clock"
  | "expired"
  | "forecast-capacity"
  | "heavy"
  | "midnight"
  | "multi-full"
  | "moderate"
  | "pending-error"
  | "pending-success"
  | "provider-error"
  | "recursion"
  | "stale"
  | "success"
  | "tight-timing"
  | "traffic-unavailable"
  | "vehicle-full";

export interface FixtureAudit {
  apiCalls: number;
  lastBufferMinutes: number | null;
  lastMode: TravelMode | null;
  lastOriginKind: "address" | "coordinates" | "place" | null;
  lastSharedUrl: string | null;
  locationRequests: number;
  scenario: FixtureScenario;
  shareCalls: number;
}

declare global {
  interface Window {
    __sailingFixture: FixtureAudit;
  }
}

const SCENARIOS = new Set<FixtureScenario>([
  "buffer-only-late",
  "capacity-recovery",
  "tied-repair",
  "capacity-unavailable",
  "denied",
  "departed-clock",
  "expired",
  "forecast-capacity",
  "heavy",
  "midnight",
  "multi-full",
  "moderate",
  "pending-error",
  "pending-success",
  "provider-error",
  "recursion",
  "stale",
  "success",
  "tight-timing",
  "traffic-unavailable",
  "vehicle-full",
]);

// read one bounded deterministic fixture scenario
const readScenario = (): FixtureScenario => {
  const value = new URL(window.location.href).searchParams.get("scenario");
  // use success for absent or unrecognized fixture values
  if (value && SCENARIOS.has(value as FixtureScenario)) {
    return value as FixtureScenario;
  }
  return "success";
};

export const fixtureAudit: FixtureAudit = {
  apiCalls: 0,
  lastBufferMinutes: null,
  lastMode: null,
  lastOriginKind: null,
  lastSharedUrl: null,
  locationRequests: 0,
  scenario: readScenario(),
  shareCalls: 0,
};

window.__sailingFixture = fixtureAudit;

const fixtureNow = Math.floor(Date.now() / 1000);
const fixtureMidnightArrival = Math.floor(
  DateTime.now()
    .setZone("America/Los_Angeles")
    .plus({ days: 1 })
    .startOf("day")
    .minus({ minutes: 10 })
    .toSeconds()
);

// select departures around the active scenario's point arrival
const readFixtureDepartureOffsets = (): number[] => {
  // leave three real minutes before cutoff but miss the preferred five-minute margin
  if (fixtureAudit.scenario === "buffer-only-late") {
    return [25 * 60, 40 * 60, 80 * 60, 120 * 60];
  }
  // cross one near-term departure with the browser-controlled date
  if (fixtureAudit.scenario === "departed-clock") {
    return [8, 10 * 60, 20 * 60, 30 * 60];
  }
  // straddle terminal-local midnight with an earlier and later context
  if (fixtureAudit.scenario === "midnight") {
    return [
      fixtureMidnightArrival - fixtureNow - 5 * 60,
      fixtureMidnightArrival - fixtureNow + 20 * 60,
      fixtureMidnightArrival - fixtureNow + 60 * 60,
      fixtureMidnightArrival - fixtureNow + 100 * 60,
    ];
  }
  return [19 * 60, 40 * 60, 80 * 60, 120 * 60];
};
const fixtureDepartureOffsets = readFixtureDepartureOffsets();
const forecastFullProbabilities = [0.9, 0.6, 0.35, 0.15];

// construct four future synthetic sailings around the browser clock
export const fixtureSchedule: Schedule = {
  date: "fixture-today",
  key: "14-5-browser-fixture",
  mateId: "5",
  terminalId: "14",
  validRange: null,
  slots: fixtureDepartureOffsets.map((offsetSeconds, index) => {
    // expose adjacent sailings around both buffer-selected outcomes
    const names = [
      "MV Earlier Fixture",
      "MV Estimated Fixture",
      "MV Later Fixture",
      "MV Buffer Fixture",
    ];
    let driveUpCapacity = index === 1 ? 0 : 10;
    // isolate the safety-margin mismatch from actual capacity risk
    if (fixtureAudit.scenario === "buffer-only-late") {
      driveUpCapacity = 30;
    }
    return {
      allowsPassengers: true,
      allowsVehicles: true,
      estimate: {
        driveUpCapacity,
        ...(fixtureAudit.scenario === "forecast-capacity" ||
        fixtureAudit.scenario === "midnight"
          ? { fullProbability: forecastFullProbabilities[index] }
          : {}),
        reservableCapacity: null,
      },
      hasPassed: false,
      mateId: "5",
      time: fixtureNow + offsetSeconds,
      vessel: {
        id: String(index + 1),
        name: names[index],
        vehicleCapacity: 100,
        tallVehicleCapacity: 0,
      },
      wuid: `fixture-${index + 1}`,
    } as Slot;
  }),
};

export const fixtureRevision =
  getSailingRecommendationRevision(fixtureSchedule);

// notify the visual harness without including an origin value
export const publishFixtureAudit = (): void => {
  window.dispatchEvent(new CustomEvent("sailing-fixture-audit"));
};

// record only non-sensitive request metadata for browser assertions
export const recordRecommendationCall = (
  input: SailingRecommendationRequest
): void => {
  fixtureAudit.apiCalls += 1;
  fixtureAudit.lastBufferMinutes = input.bufferMinutes;
  fixtureAudit.lastMode = input.mode;
  fixtureAudit.lastOriginKind = input.origin.kind;
  publishFixtureAudit();
};

// record an explicit foreground request without storing coordinates
export const recordLocationRequest = (): void => {
  fixtureAudit.locationRequests += 1;
  publishFixtureAudit();
};

// record only the synthetic fixture link selected for native sharing
export const recordShareCall = (url: string): void => {
  fixtureAudit.lastSharedUrl = url;
  fixtureAudit.shareCalls += 1;
  publishFixtureAudit();
};

// create one current direct capacity anchor per sailing
const makeObservations = (): FillTimingObservation[] => {
  // model an unknown inventory source without fabricating a chance
  if (
    fixtureAudit.scenario === "capacity-unavailable" ||
    fixtureAudit.scenario === "forecast-capacity" ||
    fixtureAudit.scenario === "midnight"
  ) {
    return [];
  }
  const spaces = fixtureAudit.scenario === "vehicle-full" ? 0 : 30;
  const current = fixtureSchedule.slots.map(
    (slot, index): FillTimingObservation => ({
      allocationGroupId: `fixture-allocation-${index + 1}`,
      departureTime: slot.time,
      driveUpDisplayed: true,
      driveUpSpaces: spaces,
      isCancelled: false,
      maxSpaceCount: 100,
      pollId: "fixture-poll",
      receivedAt: fixtureNow - 15,
      reportingStateAtReceipt: "active",
      sourceKind: "wsf-direct",
      usableForFillLabel: true,
      vesselId: slot.vessel.id,
    })
  );
  // unavailable predecessors cannot hide the later sailing's own live model
  if (fixtureAudit.scenario === "capacity-recovery") {
    return current.slice(2);
  }
  // a repair at the same timestamp must yield to the direct WSF report
  if (fixtureAudit.scenario === "tied-repair") {
    return current.flatMap((observation) => [
      observation,
      {
        ...observation,
        allocationGroupId: `repair-${observation.allocationGroupId}`,
        sourceKind: "repair-derived" as const,
        reportingStateAtReceipt: "unknown" as const,
        usableForFillLabel: false,
      },
    ]);
  }
  // a steep observed decline fills multiple sailing intervals for dense-caption verification
  if (fixtureAudit.scenario === "multi-full") {
    return current.flatMap((observation) => [
      {
        ...observation,
        driveUpSpaces: 90,
        receivedAt: fixtureNow - 315,
        pollId: "fixture-earlier-poll",
      },
      {
        ...observation,
        driveUpSpaces: 60,
        receivedAt: fixtureNow - 165,
        pollId: "fixture-middle-poll",
      },
      observation,
    ]);
  }
  return current;
};

// derive the fixture's provider duration and static baseline
const routeTiming = (): {
  durationSeconds: number;
  staticDurationSeconds: number | null;
  trafficAware: boolean;
} => {
  // reproduce an arrival before cutoff but after the preferred buffered target
  if (fixtureAudit.scenario === "buffer-only-late") {
    return {
      durationSeconds: 19 * 60,
      staticDurationSeconds: 16 * 60,
      trafficAware: true,
    };
  }
  // keep one catchable sailing close enough for the browser clock to pass it
  if (fixtureAudit.scenario === "departed-clock") {
    return {
      durationSeconds: 0,
      staticDurationSeconds: 0,
      trafficAware: true,
    };
  }
  // place one deterministic estimate across the terminal-local midnight boundary
  if (fixtureAudit.scenario === "midnight") {
    const durationSeconds = fixtureMidnightArrival - fixtureNow;
    return {
      durationSeconds,
      staticDurationSeconds: durationSeconds,
      trafficAware: true,
    };
  }
  // retain a point route with no provider traffic classification
  if (fixtureAudit.scenario === "traffic-unavailable") {
    return {
      durationSeconds: 20 * 60,
      staticDurationSeconds: null,
      trafficAware: false,
    };
  }
  // keep the point arrival just inside the advisory boundary
  if (fixtureAudit.scenario === "tight-timing") {
    return {
      durationSeconds: 21 * 60,
      staticDurationSeconds: 20 * 60,
      trafficAware: true,
    };
  }
  // exercise the app-defined heavy delay color
  if (fixtureAudit.scenario === "heavy") {
    return {
      durationSeconds: 20 * 60,
      staticDurationSeconds: 10 * 60,
      trafficAware: true,
    };
  }
  // exercise the app-defined moderate delay color
  if (fixtureAudit.scenario === "moderate") {
    return {
      durationSeconds: 20 * 60,
      staticDurationSeconds: 16 * 60,
      trafficAware: true,
    };
  }
  return {
    durationSeconds: 20 * 60,
    staticDurationSeconds: 19 * 60,
    trafficAware: true,
  };
};

// classify one deterministic drive delay with the production thresholds
const trafficLevel = (
  mode: TravelMode,
  durationSeconds: number,
  staticDurationSeconds: number | null,
  trafficAware: boolean
): SailingRecommendationResponse["trafficLevel"] => {
  // withhold color when current traffic or its baseline is unavailable
  if (mode !== "drive" || !trafficAware || !staticDurationSeconds) {
    return null;
  }
  const delay = Math.max(0, durationSeconds - staticDurationSeconds);
  const ratio = delay / staticDurationSeconds;
  // group a negligible delay as light traffic
  if (delay < 120 || ratio < 0.15) {
    return "light";
  }
  // separate a material delay from a severe delay
  if (delay < 600 && ratio < 0.4) {
    return "moderate";
  }
  return "heavy";
};

// construct one normalized routing failure
const makeFailure = (
  input: SailingRecommendationRequest,
  reason: "ferry-route-recursion" | "provider-quota-unavailable"
): SailingRecommendationResponse => ({
  arrivalAt: null,
  attribution: "Google Maps",
  bufferOutcomeBands: [],
  capacityWatermark: null,
  durationSeconds: null,
  mode: input.mode,
  outcome: {
    reason,
    result: "routing-unavailable",
    sailing: null,
    skipped: [],
  },
  partialMatch: false,
  recommendationAsOf: fixtureNow,
  revision: null,
  routeRequestedAt: fixtureNow,
  sailingAssessments: [],
  source: "google-routes",
  staticDurationSeconds: null,
  trafficAware: null,
  trafficDelaySeconds: null,
  trafficLevel: null,
  travelUncertainty: null,
  validUntil: fixtureNow + 120,
  warnings:
    reason === "ferry-route-recursion"
      ? ["Ferry travel is excluded from the route to the terminal."]
      : [],
});

// produce the selected deterministic provider response
export const makeFixtureResponse = (
  input: SailingRecommendationRequest
): SailingRecommendationResponse => {
  // exercise the provider failure copy without a network request
  if (
    fixtureAudit.scenario === "provider-error" ||
    fixtureAudit.scenario === "pending-error"
  ) {
    return makeFailure(input, "provider-quota-unavailable");
  }
  // exercise typed ferry recursion rejection and its warning
  if (fixtureAudit.scenario === "recursion") {
    return makeFailure(input, "ferry-route-recursion");
  }
  const observations = makeObservations();
  const { durationSeconds, staticDurationSeconds, trafficAware } =
    routeTiming();
  const arrivalAt = fixtureNow + durationSeconds;
  let travelUncertainty = createTravelUncertainty({
    durationSeconds,
    mode: input.mode,
    routeRequestedAt: fixtureNow,
    staticDurationSeconds,
    trafficAware,
  });
  // keep the midnight fixture focused on label ordering rather than an all-day prior
  if (fixtureAudit.scenario === "midnight") {
    travelUncertainty = {
      earliestArrivalAt: arrivalAt - 3 * 60,
      latestArrivalAt: arrivalAt + 3 * 60,
      modelVersion: "triangular-travel-v1",
      widthSeconds: 3 * 60,
    };
  }
  const bufferOutcomeBands = buildRecommendationBands({
    arrivalAt,
    asOf: fixtureNow,
    mode: input.mode,
    observations,
    schedule: fixtureSchedule,
  });
  const sailingAssessments = buildSailingAssessments({
    arrivalAt,
    asOf: fixtureNow,
    bands: bufferOutcomeBands,
    mode: input.mode,
    observations,
    schedule: fixtureSchedule,
    travelUncertainty,
  });
  const outcome =
    bufferOutcomeBands.find(
      // select the server-owned buffer band for this explicit request
      (band) =>
        input.bufferMinutes >= band.minimumBufferMinutes &&
        input.bufferMinutes <= band.maximumBufferMinutes
    )?.outcome ?? bufferOutcomeBands[0].outcome;
  const delaySeconds =
    input.mode === "drive" && trafficAware && staticDurationSeconds !== null
      ? Math.max(0, durationSeconds - staticDurationSeconds)
      : null;
  return {
    arrivalAt,
    attribution: "Google Maps",
    bufferOutcomeBands,
    capacityWatermark: observations.length ? fixtureNow - 15 : null,
    durationSeconds,
    mode: input.mode,
    outcome,
    partialMatch: false,
    recommendationAsOf: fixtureNow,
    revision:
      fixtureAudit.scenario === "stale"
        ? "fixture-stale-revision"
        : fixtureRevision,
    routeRequestedAt: fixtureNow,
    sailingAssessments,
    source: "google-routes",
    staticDurationSeconds,
    trafficAware: input.mode === "drive" ? trafficAware : false,
    trafficDelaySeconds: delaySeconds,
    trafficLevel: trafficLevel(
      input.mode,
      durationSeconds,
      staticDurationSeconds,
      trafficAware
    ),
    travelUncertainty,
    validUntil:
      fixtureAudit.scenario === "expired" ? fixtureNow - 1 : fixtureNow + 120,
    warnings: [],
  };
};
