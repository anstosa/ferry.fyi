import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AutomaticCheckinCandidateV1,
} from "../contracts/leaderboards";

export interface AutomaticTrustedClockAnchorV1 {
  bootId: string;
  monotonicTimeMs: number;
  serverTimeMs: number;
  wallTimeMs: number;
}

export interface AutomaticTrustedClockSampleV1 {
  bootId: string;
  monotonicTimeMs: number;
  wallTimeMs: number;
}

export type AutomaticCandidateServerTimeDecisionV1 =
  | "admitted"
  | "expired"
  | "future_timestamp";

export interface AutomaticQueueCapacityResultV1 {
  dropped: AutomaticCheckinCandidateV1[];
  retained: AutomaticCheckinCandidateV1[];
}

// validate finite monotonic timestamps
const isSafeTimestamp = (value: number): boolean => {
  return Number.isSafeInteger(value) && value >= 0;
};

// validate a same-boot reading
const elapsedMonotonicMs = (
  anchor: AutomaticTrustedClockAnchorV1,
  sample: AutomaticTrustedClockSampleV1
): number | null => {
  // reject malformed clocks and rebooted samples
  if (
    anchor.bootId.length === 0 ||
    sample.bootId !== anchor.bootId ||
    !isSafeTimestamp(anchor.monotonicTimeMs) ||
    !isSafeTimestamp(anchor.serverTimeMs) ||
    !isSafeTimestamp(anchor.wallTimeMs) ||
    !isSafeTimestamp(sample.monotonicTimeMs) ||
    !isSafeTimestamp(sample.wallTimeMs) ||
    sample.monotonicTimeMs < anchor.monotonicTimeMs
  ) {
    return null;
  }

  return sample.monotonicTimeMs - anchor.monotonicTimeMs;
};

// add an elapsed duration safely
const addElapsed = (base: number, elapsed: number): number | null => {
  const result = base + elapsed;

  // reject numeric overflow
  if (!Number.isSafeInteger(result)) {
    return null;
  }

  return result;
};

// derive capture time from monotonic progress only
export const deriveAutomaticCapturedAtMsV1 = (
  anchor: AutomaticTrustedClockAnchorV1,
  sample: AutomaticTrustedClockSampleV1
): number | null => {
  const monotonicElapsed = elapsedMonotonicMs(anchor, sample);

  // block capture without a same-boot anchor
  if (monotonicElapsed === null) {
    return null;
  }

  return addElapsed(anchor.serverTimeMs, monotonicElapsed);
};

// derive expiry time from the least-forgiving clock
export const deriveAutomaticExpiryNowMsV1 = (
  anchor: AutomaticTrustedClockAnchorV1,
  sample: AutomaticTrustedClockSampleV1
): number | null => {
  const monotonicElapsed = elapsedMonotonicMs(anchor, sample);

  // block upload without a same-boot anchor
  if (monotonicElapsed === null) {
    return null;
  }

  const wallElapsed = Math.max(0, sample.wallTimeMs - anchor.wallTimeMs);
  return addElapsed(
    anchor.serverTimeMs,
    Math.max(monotonicElapsed, wallElapsed)
  );
};

// enforce the exact logical retention boundary
export const isAutomaticCandidateExpiredV1 = (
  capturedAtMs: number,
  trustedNowMs: number
): boolean => {
  // fail closed for invalid timestamps
  if (!isSafeTimestamp(capturedAtMs) || !isSafeTimestamp(trustedNowMs)) {
    return true;
  }

  return (
    trustedNowMs >= capturedAtMs &&
    trustedNowMs - capturedAtMs >= AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS
  );
};

// apply the database clock time policy
export const classifyAutomaticCandidateServerTimeV1 = (
  capturedAtMs: number,
  dbNowMs: number,
  futureToleranceMs: number
): AutomaticCandidateServerTimeDecisionV1 => {
  // fail closed for invalid clock inputs
  if (
    !isSafeTimestamp(capturedAtMs) ||
    !isSafeTimestamp(dbNowMs) ||
    !isSafeTimestamp(futureToleranceMs)
  ) {
    return "future_timestamp";
  }

  // reject only beyond the inclusive future boundary
  if (capturedAtMs > dbNowMs && capturedAtMs - dbNowMs > futureToleranceMs) {
    return "future_timestamp";
  }

  // expire exactly at twelve hours
  if (isAutomaticCandidateExpiredV1(capturedAtMs, dbNowMs)) {
    return "expired";
  }

  return "admitted";
};

// order candidate work deterministically
const compareCandidateAge = (
  left: AutomaticCheckinCandidateV1,
  right: AutomaticCheckinCandidateV1
): number => {
  // order equal timestamps by opaque candidate ID
  if (left.capturedAtMs === right.capturedAtMs) {
    // order lower IDs first
    if (left.candidateId < right.candidateId) {
      return -1;
    }

    // order higher IDs last
    if (left.candidateId > right.candidateId) {
      return 1;
    }

    return 0;
  }

  return left.capturedAtMs - right.capturedAtMs;
};

// select one independent upload head per terminal
export const selectAutomaticCandidateUploadHeadsV1 = (
  candidates: readonly AutomaticCheckinCandidateV1[]
): AutomaticCheckinCandidateV1[] => {
  const selected: AutomaticCheckinCandidateV1[] = [];
  const selectedTerminalIds = new Set<string>();

  // visit oldest work before its same-terminal successors
  for (const candidate of [...candidates].sort(compareCandidateAge)) {
    // keep every vessel outside terminal head-of-line blocking
    if (candidate.kind === "vessel") {
      selected.push(candidate);
      continue;
    }

    // block only newer work for the same terminal
    if (selectedTerminalIds.has(candidate.terminalId)) {
      continue;
    }

    selectedTerminalIds.add(candidate.terminalId);
    selected.push(candidate);
  }

  return selected;
};

// drop the oldest-expiring overflow first
export const applyAutomaticQueueCapacityV1 = (
  candidates: readonly AutomaticCheckinCandidateV1[],
  configuredCapacity: number
): AutomaticQueueCapacityResultV1 => {
  // reject unusable configured capacity
  if (!Number.isSafeInteger(configuredCapacity) || configuredCapacity <= 0) {
    throw new Error("invalid automatic queue capacity");
  }

  const ordered = [...candidates].sort(compareCandidateAge);
  const overflowCount = Math.max(0, ordered.length - configuredCapacity);
  return {
    dropped: ordered.slice(0, overflowCount),
    retained: ordered.slice(overflowCount),
  };
};
