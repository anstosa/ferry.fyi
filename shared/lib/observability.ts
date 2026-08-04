export const OBSERVABILITY_SCHEMA_VERSION = 1 as const;

export type SourceAgeResult =
  | { ageMs: number; outcome: "valid" }
  | { ageMs: null; outcome: "future" | "invalid" | "unavailable" };

export type OperationLagOutcome =
  | "failed"
  | "never-run"
  | "overdue"
  | "running"
  | "stale"
  | "succeeded";

export interface OperationLagInput {
  cadenceMs: number;
  endedAt: string | null;
  leaseExpiresAt: string | null;
  startedAt: string | null;
  status: "failed" | "idle" | "running" | "succeeded";
}

export interface OperationLagResult {
  lagMs: number | null;
  outcome: OperationLagOutcome;
  reason?: "expired-lease" | "invalid-status-time" | "missing-lease";
}

export interface AvailabilityInput {
  evidencedMonitorOutageAttempts?: number;
  observedAttempts: number;
  plannedMaintenanceAttempts?: number;
  scheduledAttempts: number;
  successfulAttempts: number;
}

export interface AvailabilityResult {
  availability: number | null;
  coverage: number | null;
  denominator: number;
  missingAttempts: number;
  reportable: boolean;
  successfulAttempts: number;
}

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const timestamp = (value: string | null): number | null => {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const percentile = (
  values: readonly number[],
  quantile: number
): number | null => {
  if (values.length === 0 || quantile < 0 || quantile > 1) {
    return null;
  }
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(quantile * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
};

export const rate = (numerator: number, denominator: number): number | null => {
  if (
    !isNonNegativeInteger(numerator) ||
    !isNonNegativeInteger(denominator) ||
    numerator > denominator ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
};

export const calculateAvailability = ({
  evidencedMonitorOutageAttempts = 0,
  observedAttempts,
  plannedMaintenanceAttempts = 0,
  scheduledAttempts,
  successfulAttempts,
}: AvailabilityInput): AvailabilityResult => {
  const counts = [
    evidencedMonitorOutageAttempts,
    observedAttempts,
    plannedMaintenanceAttempts,
    scheduledAttempts,
    successfulAttempts,
  ];
  if (counts.some((value) => !isNonNegativeInteger(value))) {
    throw new Error("Availability counts must be non-negative integers");
  }
  const denominator = Math.max(
    0,
    scheduledAttempts -
      plannedMaintenanceAttempts -
      evidencedMonitorOutageAttempts
  );
  if (observedAttempts > denominator || successfulAttempts > observedAttempts) {
    throw new Error("Availability counts are inconsistent");
  }
  const missingAttempts = denominator - observedAttempts;
  const coverage = rate(observedAttempts, denominator);
  return {
    availability: rate(successfulAttempts, denominator),
    coverage,
    denominator,
    missingAttempts,
    reportable: coverage !== null && coverage >= 0.95,
    successfulAttempts,
  };
};

export const calculateSourceAge = ({
  retrievedAt,
  sourceTimestamp,
}: {
  retrievedAt: string;
  sourceTimestamp: string | null | undefined;
}): SourceAgeResult => {
  const retrievalTime = timestamp(retrievedAt);
  if (retrievalTime === null) {
    return { ageMs: null, outcome: "invalid" };
  }
  if (sourceTimestamp === null || sourceTimestamp === undefined) {
    return { ageMs: null, outcome: "unavailable" };
  }
  const sourceTime = timestamp(sourceTimestamp);
  if (sourceTime === null) {
    return { ageMs: null, outcome: "invalid" };
  }
  if (sourceTime > retrievalTime) {
    return { ageMs: null, outcome: "future" };
  }
  return { ageMs: retrievalTime - sourceTime, outcome: "valid" };
};

export const calculateOperationLag = (
  input: OperationLagInput,
  now: string
): OperationLagResult => {
  const nowTime = timestamp(now);
  if (
    nowTime === null ||
    !Number.isFinite(input.cadenceMs) ||
    input.cadenceMs <= 0
  ) {
    return {
      lagMs: null,
      outcome: "stale",
      reason: "invalid-status-time",
    };
  }
  const startedAt = timestamp(input.startedAt);
  const endedAt = timestamp(input.endedAt);
  const leaseExpiresAt = timestamp(input.leaseExpiresAt);

  if (input.status === "idle" && startedAt === null && endedAt === null) {
    return { lagMs: null, outcome: "never-run" };
  }
  if (input.status === "running") {
    if (startedAt === null) {
      return {
        lagMs: null,
        outcome: "stale",
        reason: "invalid-status-time",
      };
    }
    if (leaseExpiresAt === null) {
      return {
        lagMs: nowTime - startedAt,
        outcome: "stale",
        reason: "missing-lease",
      };
    }
    if (leaseExpiresAt <= nowTime) {
      return {
        lagMs: nowTime - startedAt,
        outcome: "stale",
        reason: "expired-lease",
      };
    }
    return { lagMs: Math.max(0, nowTime - startedAt), outcome: "running" };
  }
  if (endedAt === null || endedAt > nowTime) {
    return {
      lagMs: null,
      outcome: "stale",
      reason: "invalid-status-time",
    };
  }
  const lagMs = nowTime - endedAt;
  if (input.status === "failed") {
    return { lagMs, outcome: "failed" };
  }
  if (input.status === "succeeded") {
    return {
      lagMs,
      outcome: lagMs > input.cadenceMs ? "overdue" : "succeeded",
    };
  }
  return {
    lagMs,
    outcome: "stale",
    reason: "invalid-status-time",
  };
};
