import type { Transaction } from "sequelize";
import type { AutomaticTerminalCheckinCandidateV1 } from "shared/contracts/leaderboards";

import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import type { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";
import { Route } from "~/models/Route";
import type {
  LeaderboardAutomaticCandidateProof,
  LeaderboardAutomaticCandidateProofContext,
  LeaderboardAutomaticCandidateProofEvaluator,
} from "~/services/leaderboardAutomaticCandidateReceipts";
import {
  AutomaticTerminalConfigError,
  loadAutomaticTerminalConfigGeneration,
  type LoadedAutomaticTerminalConfig,
} from "~/services/leaderboardAutomaticNativeConfig";

import {
  distanceInMeters,
  evaluateTerminalEligibility,
} from "../lib/leaderboards";

export const AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS = 100_000;

type TerminalSpatialDecision = "inside" | "outside" | "uncertain";
type RetainedRegionResult =
  | { disposition: "invalid" }
  | { disposition: "retryable" }
  | {
      disposition: "valid";
      region: LoadedAutomaticTerminalConfig["regions"][number] | null;
    };

/** terminal proof dependency seams */
export interface LeaderboardAutomaticTerminalProofOptions {
  loadConfig?: (
    configGeneration: number,
    transaction: Transaction
  ) => Promise<LoadedAutomaticTerminalConfig>;
  maxLocationAccuracyMillimeters?: number;
}

// return one fixed final rejection
const rejected = (
  outcome: Exclude<LeaderboardAutomaticCandidateProof["outcome"], "credited">
): LeaderboardAutomaticCandidateProof => ({
  credited: false,
  disposition: "final",
  outcome,
});

// return one fixed retryable decision
const retryable = (): LeaderboardAutomaticCandidateProof => ({
  credited: false,
  disposition: "retryable",
  outcome: "temporarily_unavailable",
});

// find one transaction-locked terminal presence
const lockedPresence = (
  context: LeaderboardAutomaticCandidateProofContext,
  terminalId: string
): LeaderboardTerminalPresence | null => {
  const presence = context.policy.presences.find(
    // select only the candidate terminal
    (value) => value.terminalId === terminalId
  );

  return presence ?? null;
};

// read the shortest current crossing duration
const shortestCrossingMinutes = (terminalId: string): number | null => {
  const durations = Object.values(Route.getByTerminalId(terminalId))
    .map(
      // read each route duration
      (route) => route.crossingTime
    )
    .filter(
      // retain only usable route durations
      (value) => Number.isFinite(value) && value > 0
    );
  return durations.length === 0 ? null : Math.min(...durations);
};

// classify the complete accuracy circle against immutable geometry
const spatialDecision = (
  candidate: AutomaticTerminalCheckinCandidateV1,
  region: LoadedAutomaticTerminalConfig["regions"][number]
): TerminalSpatialDecision => {
  const distanceMillimeters =
    distanceInMeters(
      {
        latitude: candidate.latitudeE7 / 10_000_000,
        longitude: candidate.longitudeE7 / 10_000_000,
      },
      {
        latitude: region.latitudeE7 / 10_000_000,
        longitude: region.longitudeE7 / 10_000_000,
      }
    ) * 1_000;

  // require the full accuracy circle inside the configured radius
  if (
    distanceMillimeters + candidate.accuracyMillimeters <=
    region.radiusMillimeters
  ) {
    return "inside";
  }

  // require the full accuracy circle outside the configured radius
  if (
    distanceMillimeters - candidate.accuracyMillimeters >
    region.radiusMillimeters
  ) {
    return "outside";
  }

  return "uncertain";
};

// load and bind one retained immutable region
const retainedRegion = async (
  candidate: AutomaticTerminalCheckinCandidateV1,
  transaction: Transaction,
  loadConfig: NonNullable<
    LeaderboardAutomaticTerminalProofOptions["loadConfig"]
  >
): Promise<RetainedRegionResult> => {
  let config: LoadedAutomaticTerminalConfig;

  // normalize durable config validation failures
  try {
    config = await loadConfig(candidate.configGeneration, transaction);
  } catch (error) {
    // classify only fixed immutable-config failures
    if (error instanceof AutomaticTerminalConfigError) {
      return { disposition: "invalid" };
    }
    return { disposition: "retryable" };
  }

  // reject a loader that did not return the requested generation
  if (
    config.configGeneration !== candidate.configGeneration ||
    config.activatedAt.getTime() > candidate.capturedAtMs
  ) {
    return { disposition: "invalid" };
  }

  const region = config.regions.find(
    // bind both terminal and generation metadata
    (value) =>
      value.terminalId === candidate.terminalId &&
      value.configGeneration === candidate.configGeneration
  );
  return { disposition: "valid", region: region ?? null };
};

// update one accepted outside observation
const recordExit = async (
  presence: LeaderboardTerminalPresence,
  eventAt: Date,
  context: LeaderboardAutomaticCandidateProofContext
): Promise<LeaderboardAutomaticCandidateProof> => {
  await presence.update(
    { exitedAt: eventAt, lastObservedAt: eventAt },
    { transaction: context.policy.transaction }
  );
  return rejected("outside_terminal");
};

// create one credited entry and advance shared chronology
const recordEntry = async (
  candidate: AutomaticTerminalCheckinCandidateV1,
  presence: LeaderboardTerminalPresence,
  eventAt: Date,
  context: LeaderboardAutomaticCandidateProofContext
): Promise<LeaderboardAutomaticCandidateProof> => {
  let crossingMinutes: number | null;

  // normalize transient route-cache failures
  try {
    crossingMinutes = shortestCrossingMinutes(candidate.terminalId);
  } catch {
    return retryable();
  }

  // retry while route duration data is unavailable
  if (crossingMinutes === null) {
    return retryable();
  }

  const eligibility = evaluateTerminalEligibility(
    presence,
    eventAt,
    crossingMinutes
  );

  // fail closed on active presence or cooldown
  if (!eligibility.eligible) {
    return rejected("stale_event");
  }

  const checkin = await LeaderboardCheckin.create(
    {
      entityId: candidate.terminalId,
      kind: "terminal",
      occurredAt: eventAt,
      sailingId: null,
      subject: context.enrollment.subject,
    },
    { transaction: context.policy.transaction }
  );
  const checkinId = Number((checkin as unknown as { id: number }).id);

  // require one durable receipt reference
  if (!Number.isSafeInteger(checkinId) || checkinId <= 0) {
    throw new Error("automatic terminal check-in id unavailable");
  }

  await presence.update(
    {
      exitedAt: null,
      lastCreditedAt: eventAt,
      lastObservedAt: eventAt,
    },
    { transaction: context.policy.transaction }
  );
  return {
    checkinId,
    credited: true,
    disposition: "final",
    outcome: "credited",
  };
};

// apply one definitive terminal observation under policy locks
const evaluateTerminalCandidate = async (
  candidate: AutomaticTerminalCheckinCandidateV1,
  context: LeaderboardAutomaticCandidateProofContext,
  options: Required<LeaderboardAutomaticTerminalProofOptions>
): Promise<LeaderboardAutomaticCandidateProof> => {
  // reject fixes outside the versioned accuracy bound
  if (candidate.accuracyMillimeters > options.maxLocationAccuracyMillimeters) {
    return rejected("location_accuracy_too_low");
  }

  const retained = await retainedRegion(
    candidate,
    context.policy.transaction,
    options.loadConfig
  );

  // reject missing or invalid immutable generations
  if (retained.disposition === "invalid") {
    return rejected("terminal_config_unavailable");
  }

  // retain retryable work on transient config-store failures
  if (retained.disposition === "retryable") {
    return retryable();
  }

  // reject a terminal absent from the exact generation
  if (!retained.region) {
    return rejected("terminal_not_found");
  }

  const spatial = spatialDecision(candidate, retained.region);

  // reject accuracy circles that cross the boundary
  if (spatial === "uncertain") {
    return rejected("location_accuracy_too_low");
  }

  const eventAt = new Date(candidate.capturedAtMs);
  const presence = lockedPresence(context, candidate.terminalId);

  // retain retryable work if proof locks disappeared
  if (!presence) {
    return retryable();
  }

  const lastObservedMs = presence.lastObservedAt?.getTime();
  const exitedAtMs = presence.exitedAt?.getTime();
  const lastCreditedMs = presence.lastCreditedAt?.getTime();
  // protect every persisted chronology timestamp
  const chronologyFloorMs = Math.max(
    ...(lastObservedMs === undefined ? [] : [lastObservedMs]),
    ...(exitedAtMs === undefined ? [] : [exitedAtMs]),
    ...(lastCreditedMs === undefined ? [] : [lastCreditedMs])
  );
  const equalExitEntry =
    spatial === "inside" && exitedAtMs === candidate.capturedAtMs;

  // reject chronology rollback and conflicting equality
  if (
    Number.isFinite(chronologyFloorMs) &&
    (candidate.capturedAtMs < chronologyFloorMs ||
      (candidate.capturedAtMs === chronologyFloorMs && !equalExitEntry))
  ) {
    return rejected("stale_event");
  }

  // record every definitive newer outside event
  if (spatial === "outside") {
    return await recordExit(presence, eventAt, context);
  }

  // enforce explicit automatic re-entry chronology
  if (
    presence.lastCreditedAt &&
    (!presence.exitedAt ||
      presence.lastCreditedAt.getTime() >= presence.exitedAt.getTime() ||
      presence.exitedAt.getTime() > candidate.capturedAtMs)
  ) {
    return rejected("stale_event");
  }

  return await recordEntry(candidate, presence, eventAt, context);
};

/** builds the production terminal proof evaluator */
export const createLeaderboardAutomaticTerminalProofEvaluator = (
  options: LeaderboardAutomaticTerminalProofOptions = {}
): LeaderboardAutomaticCandidateProofEvaluator => {
  const resolved: Required<LeaderboardAutomaticTerminalProofOptions> = {
    loadConfig:
      options.loadConfig ??
      // load only exact durable history
      ((configGeneration, transaction) =>
        loadAutomaticTerminalConfigGeneration(
          configGeneration,
          undefined,
          transaction
        )),
    maxLocationAccuracyMillimeters:
      options.maxLocationAccuracyMillimeters ??
      AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
  };

  // reject unsafe accuracy policy
  if (
    !Number.isSafeInteger(resolved.maxLocationAccuracyMillimeters) ||
    resolved.maxLocationAccuracyMillimeters < 0
  ) {
    throw new Error("invalid automatic terminal accuracy policy");
  }

  // dispatch only terminal proof in the production evaluator
  return async (context) => {
    // keep vessel credit disabled until its production gate
    if (context.candidate.kind !== "terminal") {
      return rejected("history_unavailable");
    }

    return await evaluateTerminalCandidate(
      context.candidate,
      context,
      resolved
    );
  };
};
