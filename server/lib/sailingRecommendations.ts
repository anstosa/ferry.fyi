import type {
  BufferOutcomeBand,
  FillTimingCapacity,
  RecommendationOutcome,
  SailingAssessment,
  SailingSkipReason,
  TravelMode,
  TravelUncertainty,
} from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { getBoardingRule } from "shared/data/boardingRules";
import {
  getProjectedTiming,
  isValidDepartureObservation,
} from "shared/lib/projectedTiming";

import {
  type FillTimingObservation,
  getFillTimingRateDistribution,
  predictFillTiming,
} from "./fillTiming";
import { estimateSailingChance } from "./sailingChance";

interface RecommendationCandidatesInput {
  arrivalAt: number;
  asOf: number;
  mode: TravelMode;
  observations: FillTimingObservation[];
  schedule: Schedule;
}

interface Candidate {
  sailingId: string;
  capacity: FillTimingCapacity | null;
  departed: boolean;
  projectedDepartureAt: number;
  slot: Slot;
}

// reject only a confirmed departure or elapsed projected sailing
const hasDeparted = (slot: Slot, projected: number, asOf: number): boolean => {
  const matchingLiveLeg =
    (slot.vessel.scheduledDepartureTime ??
      slot.vessel.gpsDelay?.signals.scheduledDepartureTime) === slot.time;
  const observedDeparture =
    matchingLiveLeg &&
    isValidDepartureObservation(slot.vessel.departedTime, slot.time, asOf);
  const leftDock =
    matchingLiveLeg &&
    slot.vessel.isAtDock === false &&
    (!Number.isFinite(slot.vessel.departedTime) || observedDeparture);
  const recordedDeparture = isValidDepartureObservation(
    slot.crossing?.departureDelta === null ||
      slot.crossing?.departureDelta === undefined
      ? null
      : slot.time + slot.crossing.departureDelta,
    slot.time,
    asOf
  );
  return Boolean(
    observedDeparture || leftDock || recordedDeparture || projected <= asOf
  );
};

// share the same causal candidates between selection and probability details
const getRecommendationCandidates = ({
  arrivalAt,
  asOf,
  mode,
  observations,
  schedule,
}: RecommendationCandidatesInput): Candidate[] => {
  const candidates: Candidate[] = schedule.slots.map((slot, index) => {
    // project against the frozen schedule snapshot
    const timing = getProjectedTiming({ schedule: schedule.slots, slot });
    const projectedDepartureAt = timing.departureTime.toSeconds();
    return {
      sailingId: `${schedule.key}:${slot.time}:${slot.vessel.id}:${index}`,
      capacity:
        mode === "drive"
          ? predictFillTiming({
              arrivalAt,
              asOf,
              departureEstimate: slot.estimate?.driveUpCapacity ?? null,
              observations: observations.filter((observation) => {
                // isolate the exact directional sailing
                return observation.departureTime === slot.time;
              }),
              projectedDepartureAt,
            })
          : null,
      departed: hasDeparted(slot, projectedDepartureAt, asOf),
      projectedDepartureAt,
      slot,
    };
  });
  // order the projected departures independently of source order
  candidates.sort(
    (left, right) => left.projectedDepartureAt - right.projectedDepartureAt
  );
  return candidates;
};

// compute one bounded family of server-owned buffer outcomes
export const buildRecommendationBands = ({
  arrivalAt,
  asOf,
  mode,
  observations,
  schedule,
}: RecommendationCandidatesInput): BufferOutcomeBand[] => {
  const rule = getBoardingRule(schedule.terminalId, schedule.mateId, mode);
  // require a cited domestic boarding rule
  if (!rule) {
    return [];
  }
  const candidates = getRecommendationCandidates({
    arrivalAt,
    asOf,
    mode,
    observations,
    schedule,
  });
  const bands: BufferOutcomeBand[] = [];
  // exhaust the fixed integer buffer domain without another provider call
  for (let bufferMinutes = 0; bufferMinutes <= 60; bufferMinutes += 1) {
    const skipped: RecommendationOutcome["skipped"] = [];
    let outcome: RecommendationOutcome = {
      result: "no-catchable-sailing",
      sailing: null,
      skipped,
    };
    let capacityFallback: RecommendationOutcome | null = null;
    // choose the earliest eligible projected departure
    for (const candidate of candidates) {
      const { capacity, departed, projectedDepartureAt, slot } = candidate;
      const forecastFullProbability = slot.estimate?.fullProbability;
      const hasForecast =
        typeof forecastFullProbability === "number" &&
        Number.isFinite(forecastFullProbability) &&
        forecastFullProbability >= 0 &&
        forecastFullProbability <= 1;
      let reason: SailingSkipReason | null = null;
      // cancellations are never eligible
      if (slot.crossing?.isCancelled || slot.cancellationReason) {
        reason = "cancelled";
      } else if (departed) {
        // ignore confirmed or elapsed departures
        reason = "departed";
      } else if (
        mode === "drive" ? !slot.allowsVehicles : !slot.allowsPassengers
      ) {
        // require the matching boarding category
        reason = "mode-ineligible";
      } else if (
        arrivalAt + bufferMinutes * 60 >
        projectedDepartureAt - rule.cutoffSeconds
      ) {
        // apply only the separate departure-readiness boundary
        reason = "too-late";
      } else if (mode === "drive" && capacity?.predictedSpacesAtArrival === 0) {
        // known vehicle fullness does not affect non-drivers
        reason = "drive-up-full";
      }
      // retain sanitized explanations for rejected sailings
      if (reason) {
        skipped.push({ departureAt: slot.time, reason });
        continue;
      }
      const meetsOperatorAdvice =
        arrivalAt <= projectedDepartureAt - rule.advisorySeconds;
      outcome = {
        result:
          capacity?.state === "unavailable" || !meetsOperatorAdvice
            ? "timing-only"
            : "recommended",
        sailing: {
          sailingId: candidate.sailingId,
          capacity,
          meetsOperatorAdvice,
          operatorAdviceSeconds: rule.advisorySeconds,
          operatorCutoffSeconds: rule.cutoffSeconds,
          projectedDepartureAt,
          scheduledDepartureAt: slot.time,
          timingAssessment: meetsOperatorAdvice ? "normal" : "tight",
          vesselName: slot.vessel.name,
        },
        skipped: [...skipped],
      };
      // retain uncertain driver capacity only when no stronger selection exists
      if (
        mode === "drive" &&
        capacity?.state === "unavailable" &&
        !hasForecast
      ) {
        capacityFallback ??= outcome;
        skipped.push({
          departureAt: slot.time,
          reason: "capacity-unavailable",
        });
        continue;
      }
      capacityFallback = null;
      break;
    }
    // recover the earliest timing-only sailing when no capacity-backed choice exists
    if (capacityFallback) {
      outcome = capacityFallback;
    }
    const previous = bands[bands.length - 1];
    // compress adjacent equivalent selections
    if (
      previous &&
      JSON.stringify(previous.outcome) === JSON.stringify(outcome)
    ) {
      previous.maximumBufferMinutes = bufferMinutes;
    } else {
      bands.push({
        maximumBufferMinutes: bufferMinutes,
        minimumBufferMinutes: bufferMinutes,
        outcome,
      });
    }
  }
  return bands;
};

// expose only the neighboring sailings reachable through the fixed buffer domain
export const buildSailingAssessments = ({
  bands,
  travelUncertainty,
  ...input
}: RecommendationCandidatesInput & {
  bands: BufferOutcomeBand[];
  travelUncertainty: TravelUncertainty;
}): SailingAssessment[] => {
  const { arrivalAt, asOf, mode, observations, schedule } = input;
  const rule = getBoardingRule(schedule.terminalId, schedule.mateId, mode);
  // retain unavailable directions without invented probabilities
  if (!rule) {
    return [];
  }
  const candidates = getRecommendationCandidates(input);
  const included = new Set<number>();
  // include each selected sailing and its immediate chronological neighbors
  for (const band of bands) {
    const selected = band.outcome.sailing;
    let center = selected
      ? candidates.findIndex(
          (candidate) => candidate.sailingId === selected.sailingId
        )
      : candidates.findIndex(
          (candidate) =>
            candidate.projectedDepartureAt >=
            arrivalAt + band.minimumBufferMinutes * 60
        );
    // keep the final sailing visible when every remaining departure is too early
    if (center < 0) {
      center = candidates.length - 1;
    }
    // bound each context to the three requested sailings
    for (let offset = -1; offset <= 1; offset += 1) {
      const index = center + offset;
      // exclude nonexistent neighbors rather than fabricate a sailing
      if (index >= 0 && index < candidates.length) {
        included.add(index);
      }
    }
  }
  return [...included]
    .sort((left, right) => left - right)
    .map((index) => {
      // retain early-arrival and slow-fill tails even for point-rejected sailings
      const { capacity, departed, projectedDepartureAt, sailingId, slot } =
        candidates[index];
      let eligibilityReason: SailingAssessment["eligibilityReason"] = null;
      // structural exclusions remain zero regardless of assumed uncertainty
      if (slot.crossing?.isCancelled || slot.cancellationReason) {
        eligibilityReason = "cancelled";
      } else if (departed) {
        // confirmed departures cannot be boarded now
        eligibilityReason = "departed";
      } else if (
        mode === "drive" ? !slot.allowsVehicles : !slot.allowsPassengers
      ) {
        // retain the matching boarding category for every method
        eligibilityReason = "mode-ineligible";
      }
      const rateDistribution =
        mode === "drive" && eligibilityReason === null
          ? getFillTimingRateDistribution({
              arrivalAt,
              asOf,
              departureEstimate: slot.estimate?.driveUpCapacity ?? null,
              observations: observations.filter((observation) => {
                // isolate the exact directional sailing's inventory
                return observation.departureTime === slot.time;
              }),
              projectedDepartureAt,
            })
          : null;
      const meetsOperatorAdvice =
        arrivalAt <= projectedDepartureAt - rule.advisorySeconds;
      return {
        sailingId,
        capacity: eligibilityReason === null ? capacity : null,
        eligibilityReason,
        meetsOperatorAdvice,
        operatorAdviceSeconds: rule.advisorySeconds,
        operatorCutoffSeconds: rule.cutoffSeconds,
        projectedDepartureAt,
        scheduledDepartureAt: slot.time,
        timingAssessment: meetsOperatorAdvice ? "normal" : "tight",
        vesselName: slot.vessel.name,
        ...estimateSailingChance({
          arrivalAt,
          capacity,
          eligibilityReason,
          forecastFullProbability: slot.estimate?.fullProbability,
          latestArrivalAt: projectedDepartureAt - rule.cutoffSeconds,
          mode,
          rateDistribution,
          travelUncertainty,
        }),
      };
    });
};
