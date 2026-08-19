import { createHmac } from "node:crypto";

import { Op, QueryTypes, type Transaction } from "sequelize";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  type AutomaticCheckinCandidateV1,
  type AutomaticCheckinOutcome,
  type AutomaticCheckinResponseV1,
} from "shared/contracts/leaderboards";
import { classifyAutomaticCandidateServerTimeV1 } from "shared/lib/leaderboardAutomaticClock";
import {
  parseAutomaticCheckinCandidateV1,
  payloadDigestV1,
} from "shared/lib/leaderboardAutomaticContracts";

import { db } from "~/lib/db";
import {
  advanceServerPolicyGeneration,
  evaluateLeaderboardAutomaticPolicy,
  getServerPolicyGeneration,
  type LockedLeaderboardAutomaticPolicy,
  lockLeaderboardAutomaticProofState,
  withLeaderboardAutomaticPolicyTransaction,
} from "~/lib/leaderboardAutomaticPolicy";
import {
  LeaderboardAutomaticCandidateReceipt,
  type LeaderboardAutomaticCandidateReceiptState,
} from "~/models/LeaderboardAutomaticCandidateReceipt";
import type { LeaderboardAutomaticEnrollment } from "~/models/LeaderboardAutomaticEnrollment";
import { observeAutomaticEnrollmentExpiry } from "~/services/leaderboardAutomaticEnrollment";

export const AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS = 60_000;
export const AUTOMATIC_RECEIPT_PROVISIONAL_TRANSPORT_MS = 5 * 60_000;
export const AUTOMATIC_RECEIPT_PROVISIONAL_CLOCK_MS = 5 * 60_000;
export const AUTOMATIC_RECEIPT_MINIMUM_PEPPER_BYTES = 32;

const MAX_SAFE_POLICY_GENERATION = Number.MAX_SAFE_INTEGER;

const RETRYABLE_OUTCOMES = new Set<AutomaticCheckinOutcome>([
  "history_warming",
  "rate_limited",
  "temporarily_unavailable",
]);

/** fixed pre-transaction failures */
export type LeaderboardAutomaticCandidateReceiptErrorCode =
  | "invalid_candidate"
  | "invalid_pepper"
  | "invalid_policy";

/** detail-free candidate receipt failure */
export class LeaderboardAutomaticCandidateReceiptError extends Error {
  code: LeaderboardAutomaticCandidateReceiptErrorCode;

  // retain only a fixed failure code
  constructor(code: LeaderboardAutomaticCandidateReceiptErrorCode) {
    super(code);
    this.code = code;
    this.name = "LeaderboardAutomaticCandidateReceiptError";
  }
}

/** authenticated strict candidate input */
export interface LeaderboardAutomaticCandidateRequest {
  candidate: AutomaticCheckinCandidateV1;
  enrollmentId: string;
  subject: string;
}

/** proof evaluation context inside the policy transaction */
export interface LeaderboardAutomaticCandidateProofContext {
  candidate: AutomaticCheckinCandidateV1;
  dbNow: Date;
  enrollment: LeaderboardAutomaticEnrollment;
  policy: LockedLeaderboardAutomaticPolicy;
}

/** one retryable proof decision */
export interface LeaderboardAutomaticCandidateRetryableProof {
  credited: false;
  disposition: "retryable";
  outcome: AutomaticCheckinOutcome;
  retryAfterSeconds?: number;
}

/** one final rejected proof decision */
export interface LeaderboardAutomaticCandidateRejectedProof {
  credited: false;
  disposition: "final";
  outcome: AutomaticCheckinOutcome;
}

/** one final credited proof decision */
export interface LeaderboardAutomaticCandidateCreditedProof {
  checkinId: number;
  credited: true;
  disposition: "final";
  outcome: "credited";
}

export type LeaderboardAutomaticCandidateProof =
  | LeaderboardAutomaticCandidateCreditedProof
  | LeaderboardAutomaticCandidateRejectedProof
  | LeaderboardAutomaticCandidateRetryableProof;

type LeaderboardAutomaticCandidateResponseDecision =
  | LeaderboardAutomaticCandidateRejectedProof
  | LeaderboardAutomaticCandidateRetryableProof
  | {
      credited: true;
      disposition: "final";
      outcome: "credited";
    };

/** pluggable terminal or vessel proof boundary */
export type LeaderboardAutomaticCandidateProofEvaluator = (
  context: LeaderboardAutomaticCandidateProofContext
) => Promise<LeaderboardAutomaticCandidateProof>;

/** receipt lifecycle policy and proof dependencies */
export interface LeaderboardAutomaticCandidateHandlerOptions {
  candidateKeyPepper: string | Uint8Array;
  clockRetentionMs?: number;
  futureToleranceMs?: number;
  proofEvaluator?: LeaderboardAutomaticCandidateProofEvaluator;
  transportRetentionMs?: number;
}

export type LeaderboardAutomaticCandidateHandler = (
  request: LeaderboardAutomaticCandidateRequest
) => Promise<AutomaticCheckinResponseV1>;

interface ResolvedReceiptPolicy {
  clockRetentionMs: number;
  futureToleranceMs: number;
  receiptRetentionMs: number;
  transportRetentionMs: number;
}

// reject unsafe durations
const requireDuration = (value: number): number => {
  // require a safe non-negative integer
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return value;
};

/** derive the conservative receipt retention duration */
export const automaticCandidateReceiptRetentionMs = (
  futureToleranceMs: number,
  transportRetentionMs: number,
  clockRetentionMs: number
): number => {
  const future = requireDuration(futureToleranceMs);
  const transport = requireDuration(transportRetentionMs);
  const clock = requireDuration(clockRetentionMs);
  const retention =
    AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS + future + transport + clock;

  // reject retention overflow
  if (!Number.isSafeInteger(retention)) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return retention;
};

// resolve provisional server policy
const resolveReceiptPolicy = (
  options: LeaderboardAutomaticCandidateHandlerOptions
): ResolvedReceiptPolicy => {
  const futureToleranceMs =
    options.futureToleranceMs ?? AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS;
  const transportRetentionMs =
    options.transportRetentionMs ?? AUTOMATIC_RECEIPT_PROVISIONAL_TRANSPORT_MS;
  const clockRetentionMs =
    options.clockRetentionMs ?? AUTOMATIC_RECEIPT_PROVISIONAL_CLOCK_MS;

  return {
    clockRetentionMs,
    futureToleranceMs,
    receiptRetentionMs: automaticCandidateReceiptRetentionMs(
      futureToleranceMs,
      transportRetentionMs,
      clockRetentionMs
    ),
    transportRetentionMs,
  };
};

// require one dedicated candidate-key secret
const requireCandidateKeyPepper = (pepper: string | Uint8Array): void => {
  const pepperBytes =
    typeof pepper === "string"
      ? Buffer.byteLength(pepper, "utf8")
      : pepper.byteLength;

  // require a dedicated nontrivial secret
  if (pepperBytes < AUTOMATIC_RECEIPT_MINIMUM_PEPPER_BYTES) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_pepper");
  }
};

/** derive the opaque payload identity key */
export const automaticCandidateKeyV1 = (
  candidateId: string,
  pepper: string | Uint8Array
): string => {
  requireCandidateKeyPepper(pepper);

  return createHmac("sha256", pepper).update(candidateId, "utf8").digest("hex");
};

// read transaction-stable Postgres time once
const readDatabaseNow = async (transaction: Transaction): Promise<Date> => {
  const [row] = await db.query<{ dbNow: Date }>(
    'SELECT CURRENT_TIMESTAMP AS "dbNow"',
    { transaction, type: QueryTypes.SELECT }
  );
  const dbNow = row?.dbNow;

  // reject a missing database clock
  if (!(dbNow instanceof Date) || !Number.isSafeInteger(dbNow.getTime())) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return dbNow;
};

// default to a non-crediting retryable result
const unavailableProofEvaluator: LeaderboardAutomaticCandidateProofEvaluator =
  () =>
    Promise.resolve({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });

// build one fixed authenticated envelope
const responseEnvelope = (
  proof: LeaderboardAutomaticCandidateResponseDecision,
  serverPolicyGeneration: number
): AutomaticCheckinResponseV1 => ({
  credited: proof.credited,
  disposition: proof.disposition,
  outcome: proof.outcome,
  ...(proof.disposition === "retryable" && proof.retryAfterSeconds !== undefined
    ? { retryAfterSeconds: proof.retryAfterSeconds }
    : {}),
  schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  serverPolicyGeneration,
});

// normalize one receipt-backed response generation
const receiptPolicyGeneration = (value: number | string | null): number => {
  const generation = typeof value === "string" ? Number(value) : value;

  // reject missing or unsafe final replay state
  if (
    !Number.isSafeInteger(generation) ||
    generation === null ||
    generation < 0 ||
    generation > MAX_SAFE_POLICY_GENERATION
  ) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return generation;
};

// recover an immutable final receipt response
const responseFromFinalReceipt = (
  receipt: LeaderboardAutomaticCandidateReceipt
): AutomaticCheckinResponseV1 => {
  const serverPolicyGeneration = receiptPolicyGeneration(
    receipt.serverPolicyGeneration
  );

  // reconstruct the sole credited shape
  if (receipt.state === "final_credited") {
    // reject inconsistent durable state
    if (receipt.outcome !== "credited") {
      throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
    }

    return responseEnvelope(
      { credited: true, disposition: "final", outcome: "credited" },
      serverPolicyGeneration
    );
  }

  // reject inconsistent durable rejection state
  if (receipt.outcome === "credited") {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return responseEnvelope(
    {
      credited: false,
      disposition: "final",
      outcome: receipt.outcome,
    },
    serverPolicyGeneration
  );
};

// classify fixed policy denials
const policyDenial = (
  policy: LockedLeaderboardAutomaticPolicy,
  enrollment: LeaderboardAutomaticEnrollment,
  dbNow: Date
): AutomaticCheckinOutcome | null => {
  // reject committed revocation first
  if (enrollment.revokedAt !== null) {
    return "enrollment_revoked";
  }

  // reject disabled detector state
  if (!enrollment.detectorEnabled) {
    return "detector_disabled";
  }

  // enforce complete automatic policy
  if (
    !evaluateLeaderboardAutomaticPolicy(policy, dbNow, enrollment)
      .automaticEnabled
  ) {
    return "policy_disabled";
  }

  return null;
};

// validate an injected proof result
const validateProof = (
  proof: LeaderboardAutomaticCandidateProof
): LeaderboardAutomaticCandidateProof => {
  // bind the credited result shape
  if (proof.credited) {
    // require one durable check-in reference
    if (
      proof.disposition !== "final" ||
      proof.outcome !== "credited" ||
      !Number.isSafeInteger(proof.checkinId) ||
      proof.checkinId <= 0
    ) {
      throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
    }

    return proof;
  }

  // reject credited outcome without credit
  if (proof.outcome === "credited") {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  const retryableOutcome = RETRYABLE_OUTCOMES.has(proof.outcome);

  // bind retryability to fixed outcomes
  if ((proof.disposition === "retryable") !== retryableOutcome) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  // validate retry-only bounded hints
  if (proof.disposition === "retryable") {
    // reject invalid optional retry hints
    if (
      proof.retryAfterSeconds !== undefined &&
      (!Number.isSafeInteger(proof.retryAfterSeconds) ||
        proof.retryAfterSeconds <= 0 ||
        proof.retryAfterSeconds > 0xffffffff)
    ) {
      throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
    }
  }

  return proof;
};

// convert one decision into durable receipt state
const receiptState = (
  proof: LeaderboardAutomaticCandidateProof
): LeaderboardAutomaticCandidateReceiptState => {
  // preserve retryable work
  if (proof.disposition === "retryable") {
    return "retryable";
  }

  return proof.credited ? "final_credited" : "final_rejected";
};

// persist a retryable or one-way final transition
const persistProof = async (
  receipt: LeaderboardAutomaticCandidateReceipt,
  proof: LeaderboardAutomaticCandidateProof,
  attemptCount: number,
  serverPolicyGeneration: number,
  transaction: Transaction
): Promise<void> => {
  await receipt.update(
    {
      attemptCount,
      checkinId: proof.credited ? proof.checkinId : null,
      outcome: proof.outcome,
      serverPolicyGeneration:
        proof.disposition === "final" ? serverPolicyGeneration : null,
      state: receiptState(proof),
    },
    { transaction }
  );
};

// revoke one suspicious enrollment atomically
const revokeConflictedEnrollment = async (
  enrollment: LeaderboardAutomaticEnrollment,
  policy: LockedLeaderboardAutomaticPolicy,
  dbNow: Date
): Promise<void> => {
  // preserve an existing revocation generation
  if (enrollment.revokedAt !== null) {
    return;
  }

  await enrollment.update(
    {
      detectorEnabled: false,
      health: "disabled",
      healthUpdatedAt: dbNow,
      revokedAt: dbNow,
    },
    { transaction: policy.transaction }
  );
  await advanceServerPolicyGeneration(policy);
};

// create an initial retryable row before proof mutation
const createInitialReceipt = async (
  enrollmentId: string,
  candidateKey: string,
  payloadDigest: string,
  expiresAt: Date,
  transaction: Transaction
): Promise<LeaderboardAutomaticCandidateReceipt> =>
  await LeaderboardAutomaticCandidateReceipt.create(
    {
      attemptCount: 1,
      candidateKey,
      checkinId: null,
      enrollmentId,
      expiresAt,
      outcome: "temporarily_unavailable",
      payloadDigest,
      serverPolicyGeneration: null,
      state: "retryable",
    },
    { transaction }
  );

// derive a safe receipt expiry date
const receiptExpiresAt = (dbNow: Date, retentionMs: number): Date => {
  const expiresAtMs = dbNow.getTime() + retentionMs;

  // reject date overflow
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new LeaderboardAutomaticCandidateReceiptError("invalid_policy");
  }

  return new Date(expiresAtMs);
};

// select the authenticated locked enrollment
const lockedEnrollment = (
  policy: LockedLeaderboardAutomaticPolicy,
  enrollmentId: string
): LeaderboardAutomaticEnrollment | null =>
  policy.enrollments.find(
    (enrollment) => enrollment.enrollmentId === enrollmentId
  ) ?? null;

// select the payload-bound locked receipt
const lockedReceipt = (
  policy: LockedLeaderboardAutomaticPolicy,
  enrollmentId: string,
  candidateKey: string
): LeaderboardAutomaticCandidateReceipt | null =>
  policy.receipts.find(
    (receipt) =>
      receipt.enrollmentId === enrollmentId &&
      receipt.candidateKey === candidateKey
  ) ?? null;

// compute one common admission decision before domain locks
const evaluateCandidateAdmission = async (
  context: LeaderboardAutomaticCandidateProofContext,
  futureToleranceMs: number
): Promise<LeaderboardAutomaticCandidateProof | null> => {
  const timeDecision = classifyAutomaticCandidateServerTimeV1(
    context.candidate.capturedAtMs,
    context.dbNow.getTime(),
    futureToleranceMs
  );

  // bind time denials to final outcomes
  if (timeDecision !== "admitted") {
    return {
      credited: false,
      disposition: "final",
      outcome: timeDecision,
    };
  }

  // observe inclusive credential expiry exactly once
  if (context.enrollment.tokenExpiresAt.getTime() <= context.dbNow.getTime()) {
    await observeAutomaticEnrollmentExpiry(
      context.enrollment,
      context.policy,
      context.dbNow
    );
    return {
      credited: false,
      disposition: "final",
      outcome: "enrollment_expired",
    };
  }

  const denied = policyDenial(
    context.policy,
    context.enrollment,
    context.dbNow
  );

  // bind automatic policy denials to final outcomes
  if (denied !== null) {
    return { credited: false, disposition: "final", outcome: denied };
  }

  return null;
};

// apply one candidate inside the exact policy transaction
const applyCandidate = async (
  request: LeaderboardAutomaticCandidateRequest,
  candidateKey: string,
  payloadDigest: string,
  policyConfig: ResolvedReceiptPolicy,
  proofEvaluator: LeaderboardAutomaticCandidateProofEvaluator
): Promise<AutomaticCheckinResponseV1> =>
  await withLeaderboardAutomaticPolicyTransaction(
    {
      candidateKey,
      createProfile: false,
      enrollmentId: request.enrollmentId,
      lockReceipts: true,
      subject: request.subject,
    },
    // create and transition the receipt while policy rows remain locked
    async (policy) => {
      const generation = getServerPolicyGeneration(policy);
      const enrollment = lockedEnrollment(policy, request.enrollmentId);

      // fail closed if authenticated identity disappeared
      if (!enrollment) {
        return responseEnvelope(
          {
            credited: false,
            disposition: "final",
            outcome: "enrollment_revoked",
          },
          generation
        );
      }

      const dbNow = await readDatabaseNow(policy.transaction);
      const existing = lockedReceipt(
        policy,
        request.enrollmentId,
        candidateKey
      );

      // revoke same-id payload mutation without touching its receipt
      if (existing && existing.payloadDigest !== payloadDigest) {
        await revokeConflictedEnrollment(enrollment, policy, dbNow);
        return responseEnvelope(
          {
            credited: false,
            disposition: "final",
            outcome: "candidate_conflict",
          },
          getServerPolicyGeneration(policy)
        );
      }

      // replay an immutable final result without updating it
      if (existing && existing.state !== "retryable") {
        return responseFromFinalReceipt(existing);
      }

      const receipt =
        existing ??
        (await createInitialReceipt(
          request.enrollmentId,
          candidateKey,
          payloadDigest,
          receiptExpiresAt(dbNow, policyConfig.receiptRetentionMs),
          policy.transaction
        ));

      // expose the newly inserted receipt before later proof locks
      if (!existing && !policy.receipts.includes(receipt)) {
        policy.receipts.push(receipt);
      }

      const admission = await evaluateCandidateAdmission(
        { candidate: request.candidate, dbNow, enrollment, policy },
        policyConfig.futureToleranceMs
      );
      let proof = admission;

      // acquire domain locks only for admitted proof work
      if (!proof) {
        const proofPolicy =
          request.candidate.kind === "terminal"
            ? {
                ...policy,
                ...(await lockLeaderboardAutomaticProofState(policy, {
                  createPresence: true,
                  lockPresence: true,
                  subject: request.subject,
                  terminalId: request.candidate.terminalId,
                })),
              }
            : policy;
        proof = validateProof(
          await proofEvaluator({
            candidate: request.candidate,
            dbNow,
            enrollment,
            policy: proofPolicy,
          })
        );
      }

      const attemptCount = existing ? existing.attemptCount + 1 : 1;
      const finalizationGeneration = getServerPolicyGeneration(policy);
      await persistProof(
        receipt,
        proof,
        attemptCount,
        finalizationGeneration,
        policy.transaction
      );
      return responseEnvelope(proof, finalizationGeneration);
    }
  );

/** build the native candidate application primitive */
export const createLeaderboardAutomaticCandidateHandler = (
  options: LeaderboardAutomaticCandidateHandlerOptions
): LeaderboardAutomaticCandidateHandler => {
  requireCandidateKeyPepper(options.candidateKeyPepper);
  const policyConfig = resolveReceiptPolicy(options);
  const proofEvaluator = options.proofEvaluator ?? unavailableProofEvaluator;

  // process only strict parsed candidate semantics
  return async (request) => {
    const candidate = parseAutomaticCheckinCandidateV1(request.candidate);

    // reject malformed semantics before database work
    if (!candidate) {
      throw new LeaderboardAutomaticCandidateReceiptError("invalid_candidate");
    }

    const candidateKey = automaticCandidateKeyV1(
      candidate.candidateId,
      options.candidateKeyPepper
    );
    const payloadDigest = await payloadDigestV1(candidate);
    return await applyCandidate(
      { ...request, candidate },
      candidateKey,
      payloadDigest,
      policyConfig,
      proofEvaluator
    );
  };
};

/** prune only receipts whose safe replay retention elapsed */
export const pruneExpiredLeaderboardAutomaticCandidateReceipts =
  async (): Promise<number> =>
    // bind clock read and deletion atomically
    await db.transaction(async (transaction) => {
      const dbNow = await readDatabaseNow(transaction);
      return await LeaderboardAutomaticCandidateReceipt.destroy({
        transaction,
        where: { expiresAt: { [Op.lte]: dbNow } },
      });
    });
