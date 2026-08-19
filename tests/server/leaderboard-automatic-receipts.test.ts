import { createRequire } from "node:module";

import { DataTypes } from "sequelize";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// hoist database seams
const database = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
// hoist policy seams
const policy = vi.hoisted(() => ({
  advanceServerPolicyGeneration: vi.fn(),
  evaluateLeaderboardAutomaticPolicy: vi.fn(),
  getServerPolicyGeneration: vi.fn(),
  lockLeaderboardAutomaticProofState: vi.fn(),
  withLeaderboardAutomaticPolicyTransaction: vi.fn(),
}));
// hoist enrollment lifecycle seams
const enrollmentLifecycle = vi.hoisted(() => ({
  observeAutomaticEnrollmentExpiry: vi.fn(),
}));
// hoist receipt seams
const receiptModel = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }));

// bind database seams
vi.mock("~/lib/db", () => ({ db: database }));
// bind policy seams
vi.mock("~/lib/leaderboardAutomaticPolicy", () => policy);
// bind enrollment lifecycle seams
vi.mock("~/services/leaderboardAutomaticEnrollment", () => enrollmentLifecycle);
// bind receipt seams
vi.mock("~/models/LeaderboardAutomaticCandidateReceipt", () => ({
  LeaderboardAutomaticCandidateReceipt: receiptModel,
}));

import {
  AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS,
  AUTOMATIC_RECEIPT_MINIMUM_PEPPER_BYTES,
  AUTOMATIC_RECEIPT_PROVISIONAL_CLOCK_MS,
  AUTOMATIC_RECEIPT_PROVISIONAL_TRANSPORT_MS,
  automaticCandidateKeyV1,
  automaticCandidateReceiptRetentionMs,
  createLeaderboardAutomaticCandidateHandler,
  type LeaderboardAutomaticCandidateProofEvaluator,
  LeaderboardAutomaticCandidateReceiptError,
  pruneExpiredLeaderboardAutomaticCandidateReceipts,
} from "../../server/services/leaderboardAutomaticCandidateReceipts";
import type { AutomaticCheckinCandidateV1 } from "../../shared/contracts/leaderboards";

const require = createRequire(import.meta.url);
const retentionMigration = require("../../server/migrations/20260817000800-restrict-automatic-receipt-enrollment-deletion.js");
const replayGenerationMigration = require("../../server/migrations/20260817000900-store-final-policy-generation-on-automatic-receipts.js");
const pepper = "test-only-dedicated-receipt-pepper";
const subject = "auth0|receipt-person";
const enrollmentId = "123e4567-e89b-42d3-a456-426614174000";
const baseNowMs = Date.parse("2026-08-17T20:00:00.000Z");

interface StoredReceipt {
  attemptCount: number;
  candidateKey: string;
  checkinId: number | null;
  enrollmentId: string;
  expiresAt: Date;
  id: number;
  outcome: string;
  payloadDigest: string;
  serverPolicyGeneration: number | string | null;
  state: "final_credited" | "final_rejected" | "retryable";
  update: Mock;
}

interface FakeTransaction {
  id: string;
}

const storedReceipts: StoredReceipt[] = [];
const checkins: Array<{ id: number }> = [];
const enrollment = {
  detectorEnabled: true,
  enrollmentId,
  health: "healthy",
  healthUpdatedAt: new Date(baseNowMs),
  expiryObservedAt: null as Date | null,
  revokedAt: null as Date | null,
  tokenExpiresAt: new Date(baseNowMs + 24 * 60 * 60 * 1000),
  update: vi.fn(),
};
const automaticFlag = { serverPolicyGeneration: 0 };
let automaticEnabled = true;
let databaseNowMs = baseNowMs;
let failAdvance = false;
let failReceiptUpdate = false;
let nextReceiptId = 1;
let policyQueue = Promise.resolve();

// build one strict terminal candidate
const terminalCandidate = (
  overrides: Partial<AutomaticCheckinCandidateV1> = {}
): AutomaticCheckinCandidateV1 =>
  ({
    accuracyMillimeters: 20_000,
    candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
    capturedAtMs: baseNowMs - 1_000,
    configGeneration: 7,
    kind: "terminal",
    latitudeE7: 476_000_000,
    longitudeE7: -1_224_000_000,
    schemaVersion: 1,
    terminalId: "7",
    ...overrides,
  }) as AutomaticCheckinCandidateV1;

// build one strict vessel candidate
const vesselCandidate = (
  overrides: Partial<AutomaticCheckinCandidateV1> = {}
): AutomaticCheckinCandidateV1 =>
  ({
    accuracyMillimeters: 20_000,
    candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
    capturedAtMs: baseNowMs - 1_000,
    kind: "vessel",
    latitudeE7: 476_000_000,
    longitudeE7: -1_224_000_000,
    sailingId: "sailing-1",
    schemaVersion: 1,
    vesselId: "vessel-1",
    ...overrides,
  }) as AutomaticCheckinCandidateV1;

// build one distinct valid opaque candidate ID
const candidateId = (prefix: string): string => `${prefix}${"A".repeat(21)}`;

// attach transactional receipt mutation
const makeStoredReceipt = (
  values: Omit<StoredReceipt, "update">
): StoredReceipt => {
  const receipt = { ...values } as StoredReceipt;
  // mutate one transaction-local receipt
  receipt.update = vi.fn(async (changes: Partial<StoredReceipt>) => {
    // inject an update failure
    if (failReceiptUpdate) {
      throw new Error("receipt update failed");
    }

    Object.assign(receipt, changes);
  });
  return receipt;
};

// snapshot mutable transaction state
const stateSnapshot = () => ({
  automaticGeneration: automaticFlag.serverPolicyGeneration,
  checkins: checkins.map((checkin) => ({ ...checkin })),
  enrollment: {
    detectorEnabled: enrollment.detectorEnabled,
    health: enrollment.health,
    healthUpdatedAt: enrollment.healthUpdatedAt,
    expiryObservedAt: enrollment.expiryObservedAt,
    revokedAt: enrollment.revokedAt,
  },
  nextReceiptId,
  receipts: storedReceipts.map((receipt) => ({
    attemptCount: receipt.attemptCount,
    candidateKey: receipt.candidateKey,
    checkinId: receipt.checkinId,
    enrollmentId: receipt.enrollmentId,
    expiresAt: receipt.expiresAt,
    id: receipt.id,
    outcome: receipt.outcome,
    payloadDigest: receipt.payloadDigest,
    serverPolicyGeneration: receipt.serverPolicyGeneration,
    state: receipt.state,
  })),
});

// restore a rolled-back transaction state
const restoreSnapshot = (snapshot: ReturnType<typeof stateSnapshot>): void => {
  automaticFlag.serverPolicyGeneration = snapshot.automaticGeneration;
  Object.assign(enrollment, snapshot.enrollment);
  checkins.splice(0, checkins.length, ...snapshot.checkins);
  storedReceipts.splice(
    0,
    storedReceipts.length,
    ...snapshot.receipts.map((receipt) => makeStoredReceipt(receipt))
  );
  ({ nextReceiptId } = snapshot);
};

// expose one locked policy fixture
const lockedPolicy = (transaction: FakeTransaction) => ({
  automaticAllowlisted: false,
  automaticFlag,
  checkins: [],
  enrollments: [enrollment],
  parentAllowlisted: false,
  parentFlag: { enabled: true, killSwitch: false },
  presences: [],
  profile: { automaticCheckinsEnabled: true, optedOut: false },
  receipts: storedReceipts,
  transaction,
});

// build one crediting proof evaluator
const creditingProof =
  (): LeaderboardAutomaticCandidateProofEvaluator =>
  // create the proof-owned check-in
  async () => {
    const checkin = { id: checkins.length + 1 };
    checkins.push(checkin);
    return {
      checkinId: checkin.id,
      credited: true,
      disposition: "final",
      outcome: "credited",
    };
  };

// process one authenticated candidate
const submit = async (
  candidate: AutomaticCheckinCandidateV1,
  proofEvaluator?: LeaderboardAutomaticCandidateProofEvaluator
) =>
  await createLeaderboardAutomaticCandidateHandler({
    candidateKeyPepper: pepper,
    proofEvaluator,
  })({ candidate, enrollmentId, subject });

// build a migration transaction harness
const migrationHarness = () => {
  const transaction = {
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const queryInterface = {
    addColumn: vi.fn().mockResolvedValue(undefined),
    addConstraint: vi.fn().mockResolvedValue(undefined),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    removeConstraint: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

// cover the complete payload-bound receipt lifecycle
describe("automatic candidate receipts", () => {
  // reset transaction and persistence seams
  beforeEach(() => {
    vi.clearAllMocks();
    storedReceipts.length = 0;
    checkins.length = 0;
    enrollment.detectorEnabled = true;
    enrollment.health = "healthy";
    enrollment.healthUpdatedAt = new Date(baseNowMs);
    enrollment.expiryObservedAt = null;
    enrollment.revokedAt = null;
    enrollment.tokenExpiresAt = new Date(baseNowMs + 24 * 60 * 60 * 1000);
    automaticFlag.serverPolicyGeneration = 0;
    automaticEnabled = true;
    databaseNowMs = baseNowMs;
    failAdvance = false;
    failReceiptUpdate = false;
    nextReceiptId = 1;
    policyQueue = Promise.resolve();

    // return one transaction-stable database time
    database.query.mockImplementation(async () => [
      { dbNow: new Date(databaseNowMs) },
    ]);
    // run cleanup transactions inline
    database.transaction.mockImplementation(
      async (callback) => await callback({ id: "cleanup-transaction" })
    );
    // serialize candidate work on the enrollment lock
    policy.withLeaderboardAutomaticPolicyTransaction.mockImplementation(
      (_options, callback) => {
        const run = policyQueue.then(async () => {
          const snapshot = stateSnapshot();
          const transaction = { id: `policy-${Date.now()}` };

          // roll back every staged mutation on failure
          try {
            return await callback(lockedPolicy(transaction));
          } catch (error) {
            restoreSnapshot(snapshot);
            throw error;
          }
        });
        policyQueue = run.then(
          // release after success
          () => undefined,
          // release after rollback
          () => undefined
        );
        return run;
      }
    );
    // expose proof locks after receipt creation
    policy.lockLeaderboardAutomaticProofState.mockResolvedValue({
      checkins: [],
      presences: [],
    });
    // expose current locked generation
    policy.getServerPolicyGeneration.mockImplementation(
      (value) => value.automaticFlag.serverPolicyGeneration
    );
    // expose one effective automatic decision
    policy.evaluateLeaderboardAutomaticPolicy.mockImplementation(() => ({
      automaticEnabled,
    }));
    // advance generation with enrollment revocation
    policy.advanceServerPolicyGeneration.mockImplementation(async () => {
      // inject generation failure
      if (failAdvance) {
        throw new Error("generation failed");
      }

      automaticFlag.serverPolicyGeneration += 1;
      return automaticFlag.serverPolicyGeneration;
    });
    // observe expiry and advance once
    enrollmentLifecycle.observeAutomaticEnrollmentExpiry.mockImplementation(
      async (value, _lockedPolicy, now) => {
        const observed = value.expiryObservedAt === null;
        // persist only the first observation
        if (observed) {
          await value.update({
            detectorEnabled: false,
            expiryObservedAt: now,
            health: "disabled",
            healthUpdatedAt: now,
          });
          await policy.advanceServerPolicyGeneration();
        }
        return {
          observed,
          serverPolicyGeneration: automaticFlag.serverPolicyGeneration,
        };
      }
    );
    // mutate the locked enrollment
    enrollment.update.mockImplementation(async (changes) => {
      Object.assign(enrollment, changes);
    });
    // insert one privacy-minimal receipt
    receiptModel.create.mockImplementation(async (values) => {
      const receipt = makeStoredReceipt({
        ...(values as Omit<StoredReceipt, "id" | "update">),
        id: nextReceiptId,
      });
      nextReceiptId += 1;
      storedReceipts.push(receipt);
      return receipt;
    });
    // delete only rows selected by safe expiry
    receiptModel.destroy.mockImplementation(async ({ where }) => {
      const expiryFilter = where.expiresAt as Record<PropertyKey, Date>;
      const [operator] = Reflect.ownKeys(expiryFilter);
      const threshold = expiryFilter[operator];
      const before = storedReceipts.length;
      // retain rows beyond the safe boundary
      for (let index = storedReceipts.length - 1; index >= 0; index -= 1) {
        // delete elapsed rows only
        if (storedReceipts[index].expiresAt.getTime() <= threshold.getTime()) {
          storedReceipts.splice(index, 1);
        }
      }
      return before - storedReceipts.length;
    });
  });

  // prove HMAC identity and minimum retention math
  it("derives opaque keys and all-term conservative retention", () => {
    expect(automaticCandidateKeyV1(candidateId("A"), pepper)).toMatch(
      /^[a-f0-9]{64}$/u
    );
    expect(automaticCandidateKeyV1(candidateId("B"), pepper)).not.toBe(
      automaticCandidateKeyV1(candidateId("A"), pepper)
    );
    // reject weak byte-array boundaries
    for (const size of [0, 1, 31]) {
      expect(() =>
        automaticCandidateKeyV1(candidateId("A"), new Uint8Array(size))
      ).toThrow("invalid_pepper");
    }
    expect(
      automaticCandidateKeyV1(candidateId("A"), new Uint8Array(32))
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      automaticCandidateReceiptRetentionMs(
        AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS,
        AUTOMATIC_RECEIPT_PROVISIONAL_TRANSPORT_MS,
        AUTOMATIC_RECEIPT_PROVISIONAL_CLOCK_MS
      )
    ).toBe(43_860_000);
  });

  // prove concurrent first submissions converge after the enrollment lock
  it("converges concurrent identical submissions on one receipt and check-in", async () => {
    let releaseProof: (() => void) | undefined;
    const proofGate = new Promise<void>((resolve) => {
      releaseProof = resolve;
    });
    const evaluator = vi.fn(
      // pause the first proof while the second submission waits
      async () => {
        await proofGate;
        return await creditingProof()({} as never);
      }
    ) as LeaderboardAutomaticCandidateProofEvaluator;
    const candidate = terminalCandidate();
    const first = submit(candidate, evaluator);
    const second = submit(candidate, evaluator);
    await vi.waitFor(() => expect(receiptModel.create).toHaveBeenCalledOnce());
    expect(
      policy.withLeaderboardAutomaticPolicyTransaction
    ).toHaveBeenCalledTimes(2);
    expect(receiptModel.create).toHaveBeenCalledOnce();
    releaseProof?.();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse).toEqual(secondResponse);
    expect(firstResponse).toMatchObject({
      credited: true,
      disposition: "final",
      outcome: "credited",
    });
    expect(storedReceipts).toHaveLength(1);
    expect(checkins).toHaveLength(1);
    expect(evaluator).toHaveBeenCalledOnce();
  });

  // prove response-loss replay preserves its committed generation
  it("replays the exact stored final envelope across generation advance", async () => {
    const evaluator = vi.fn(creditingProof());
    const candidate = terminalCandidate();
    const committed = await submit(candidate, evaluator);
    const receipt = storedReceipts[0];
    const updateCalls = receipt.update.mock.calls.length;
    expect(committed.serverPolicyGeneration).toBe(0);
    expect(receipt.serverPolicyGeneration).toBe(0);

    automaticFlag.serverPolicyGeneration = 17;

    const replayed = await submit(candidate, evaluator);
    expect(replayed).toEqual(committed);
    expect(receiptModel.create).toHaveBeenCalledOnce();
    expect(receipt.update).toHaveBeenCalledTimes(updateCalls);
    expect(evaluator).toHaveBeenCalledOnce();
    expect(checkins).toHaveLength(1);
  });

  // prove retryable receipts stay retryable then close once
  it.each([
    {
      final: {
        checkinId: 1,
        credited: true,
        disposition: "final",
        outcome: "credited",
      },
      finalState: "final_credited",
    },
    {
      final: {
        credited: false,
        disposition: "final",
        outcome: "history_unavailable",
      },
      finalState: "final_rejected",
    },
  ] as const)(
    "allows one retryable transition to $finalState",
    async ({ final, finalState }) => {
      const proofs = [
        {
          credited: false,
          disposition: "retryable",
          outcome: "history_warming",
          retryAfterSeconds: 30,
        },
        {
          credited: false,
          disposition: "retryable",
          outcome: "history_warming",
          retryAfterSeconds: 30,
        },
        final,
      ] as const;
      let proofIndex = 0;
      const evaluator = vi.fn(async () => {
        const proof = proofs[proofIndex];
        proofIndex += 1;
        // create the credited proof reference
        if (proof.credited) {
          checkins.push({ id: proof.checkinId });
        }
        return proof;
      }) as LeaderboardAutomaticCandidateProofEvaluator;
      const candidate = vesselCandidate();

      const firstRetryable = await submit(candidate, evaluator);
      expect(firstRetryable).toMatchObject({
        disposition: "retryable",
        outcome: "history_warming",
        serverPolicyGeneration: 0,
      });
      expect(storedReceipts[0].serverPolicyGeneration).toBeNull();

      automaticFlag.serverPolicyGeneration = 4;
      expect(await submit(candidate, evaluator)).toMatchObject({
        disposition: "retryable",
        outcome: "history_warming",
        serverPolicyGeneration: 4,
      });
      const finalEnvelope = {
        credited: final.credited,
        disposition: final.disposition,
        outcome: final.outcome,
      };
      const finalResponse = await submit(candidate, evaluator);
      expect(finalResponse).toMatchObject({
        ...finalEnvelope,
        serverPolicyGeneration: 4,
      });
      expect(storedReceipts[0].serverPolicyGeneration).toBe(4);
      const finalUpdateCalls = storedReceipts[0].update.mock.calls.length;
      automaticFlag.serverPolicyGeneration = 5;
      const replay = await submit(candidate, evaluator);
      expect(replay).toEqual(finalResponse);

      expect(storedReceipts[0]).toMatchObject({
        attemptCount: 3,
        state: finalState,
      });
      expect(storedReceipts[0].update).toHaveBeenCalledTimes(finalUpdateCalls);
      expect(evaluator).toHaveBeenCalledTimes(3);
    }
  );

  // prove every semantic mutation conflicts and revokes atomically
  it.each([
    [
      "coordinate",
      terminalCandidate(),
      terminalCandidate({ latitudeE7: 476_000_001 }),
    ],
    [
      "longitude",
      terminalCandidate(),
      terminalCandidate({ longitudeE7: -1_224_000_001 }),
    ],
    [
      "accuracy",
      terminalCandidate(),
      terminalCandidate({ accuracyMillimeters: 20_001 }),
    ],
    [
      "timestamp",
      terminalCandidate(),
      terminalCandidate({ capturedAtMs: baseNowMs - 999 }),
    ],
    ["kind", terminalCandidate(), vesselCandidate()],
    ["config", terminalCandidate(), terminalCandidate({ configGeneration: 8 })],
    ["terminal", terminalCandidate(), terminalCandidate({ terminalId: "8" })],
    ["vessel", vesselCandidate(), vesselCandidate({ vesselId: "vessel-2" })],
    ["sailing", vesselCandidate(), vesselCandidate({ sailingId: "sailing-2" })],
  ])("rejects same-id %s mutation", async (_name, original, mutation) => {
    await submit(original, creditingProof());
    const receipt = storedReceipts[0];
    const originalDigest = receipt.payloadDigest;
    const originalCheckinId = receipt.checkinId;
    const originalUpdateCalls = receipt.update.mock.calls.length;

    await expect(submit(mutation, creditingProof())).resolves.toMatchObject({
      credited: false,
      disposition: "final",
      outcome: "candidate_conflict",
      serverPolicyGeneration: 1,
    });
    expect(receipt).toMatchObject({
      checkinId: originalCheckinId,
      payloadDigest: originalDigest,
    });
    expect(receipt.update).toHaveBeenCalledTimes(originalUpdateCalls);
    expect(checkins).toHaveLength(1);
    expect(enrollment).toMatchObject({
      detectorEnabled: false,
      health: "disabled",
      revokedAt: new Date(baseNowMs),
    });
    expect(policy.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove conflict revocation rolls back with generation failure
  it("rolls back conflict revocation when generation advancement fails", async () => {
    await submit(terminalCandidate(), creditingProof());
    const receipt = storedReceipts[0];
    failAdvance = true;

    await expect(
      submit(
        terminalCandidate({ longitudeE7: -1_224_000_001 }),
        creditingProof()
      )
    ).rejects.toThrow("generation failed");
    expect(storedReceipts).toHaveLength(1);
    expect(storedReceipts[0]).toMatchObject({
      checkinId: receipt.checkinId,
      payloadDigest: receipt.payloadDigest,
    });
    expect(enrollment).toMatchObject({
      detectorEnabled: true,
      revokedAt: null,
    });
    expect(automaticFlag.serverPolicyGeneration).toBe(0);
  });

  // prove exact future and expiry boundaries use database time
  it("admits future equality and rejects plus one and exact expiry", async () => {
    const finalReject = vi.fn(
      // return one deterministic non-credit result
      async () => ({
        credited: false,
        disposition: "final",
        outcome: "outside_terminal",
      })
    ) as LeaderboardAutomaticCandidateProofEvaluator;

    expect(
      await submit(
        terminalCandidate({
          candidateId: candidateId("B"),
          capturedAtMs: baseNowMs + AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS,
        }),
        finalReject
      )
    ).toMatchObject({ outcome: "outside_terminal" });
    expect(
      await submit(
        terminalCandidate({
          candidateId: candidateId("C"),
          capturedAtMs: baseNowMs + AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS + 1,
        }),
        finalReject
      )
    ).toMatchObject({ outcome: "future_timestamp" });
    expect(
      await submit(
        terminalCandidate({
          candidateId: candidateId("D"),
          capturedAtMs: baseNowMs - 12 * 60 * 60 * 1000 + 1,
        }),
        finalReject
      )
    ).toMatchObject({ outcome: "outside_terminal" });
    expect(
      await submit(
        terminalCandidate({
          candidateId: candidateId("E"),
          capturedAtMs: baseNowMs - 12 * 60 * 60 * 1000,
        }),
        finalReject
      )
    ).toMatchObject({ outcome: "expired" });
    expect(finalReject).toHaveBeenCalledTimes(2);
    expect(database.query).toHaveBeenCalledTimes(4);
  });

  // prove transaction-time credential expiry advances policy once
  it("observes inclusive enrollment expiry before returning denial", async () => {
    enrollment.tokenExpiresAt = new Date(baseNowMs);
    const requestCandidate = terminalCandidate();

    const first = await submit(requestCandidate, creditingProof());
    expect(first).toMatchObject({
      credited: false,
      outcome: "enrollment_expired",
      serverPolicyGeneration: 1,
    });
    expect(enrollment).toMatchObject({
      detectorEnabled: false,
      expiryObservedAt: new Date(baseNowMs),
      health: "disabled",
    });
    expect(
      enrollmentLifecycle.observeAutomaticEnrollmentExpiry
    ).toHaveBeenCalledOnce();

    const replay = await submit(requestCandidate, creditingProof());
    expect(replay).toEqual(first);
    expect(
      enrollmentLifecycle.observeAutomaticEnrollmentExpiry
    ).toHaveBeenCalledOnce();
    expect(policy.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove default proof never creates credit
  it("defaults to a retryable non-crediting proof", async () => {
    await expect(submit(terminalCandidate())).resolves.toMatchObject({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    expect(checkins).toHaveLength(0);
    expect(storedReceipts[0].state).toBe("retryable");
  });

  // prove receipt insertion precedes terminal proof locks
  it("creates the receipt before acquiring terminal proof state", async () => {
    await submit(terminalCandidate(), creditingProof());

    expect(receiptModel.create).toHaveBeenCalledOnce();
    expect(policy.lockLeaderboardAutomaticProofState).toHaveBeenCalledWith(
      expect.objectContaining({ receipts: [expect.any(Object)] }),
      {
        createPresence: true,
        lockPresence: true,
        subject,
        terminalId: "7",
      }
    );
    expect(receiptModel.create.mock.invocationCallOrder[0]).toBeLessThan(
      policy.lockLeaderboardAutomaticProofState.mock.invocationCallOrder[0]
    );
  });

  // avoid domain state for candidates denied before proof
  it("does not acquire terminal proof state for common admission denials", async () => {
    const value = terminalCandidate({
      capturedAtMs: baseNowMs + AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS + 1,
    });

    await expect(submit(value, creditingProof())).resolves.toMatchObject({
      outcome: "future_timestamp",
    });
    expect(policy.lockLeaderboardAutomaticProofState).not.toHaveBeenCalled();
    expect(checkins).toHaveLength(0);
  });

  // prove pre-transaction validation creates no receipt
  it("rejects malformed candidates and weak peppers before transaction", async () => {
    const invalid = {
      ...terminalCandidate(),
      unexpected: "plaintext",
    } as AutomaticCheckinCandidateV1;

    await expect(submit(invalid, creditingProof())).rejects.toMatchObject({
      code: "invalid_candidate",
    });
    // reject each weak string boundary
    for (const weakPepper of ["", "x", "x".repeat(31)]) {
      expect(() =>
        createLeaderboardAutomaticCandidateHandler({
          candidateKeyPepper: weakPepper,
        })
      ).toThrow(LeaderboardAutomaticCandidateReceiptError);
    }
    expect(
      policy.withLeaderboardAutomaticPolicyTransaction
    ).not.toHaveBeenCalled();
    expect(receiptModel.create).not.toHaveBeenCalled();
    const exactPepperHandler = createLeaderboardAutomaticCandidateHandler({
      candidateKeyPepper: "x".repeat(AUTOMATIC_RECEIPT_MINIMUM_PEPPER_BYTES),
    });
    await expect(
      exactPepperHandler({
        candidate: terminalCandidate(),
        enrollmentId,
        subject,
      })
    ).resolves.toMatchObject({ disposition: "retryable" });
    expect(
      policy.withLeaderboardAutomaticPolicyTransaction
    ).toHaveBeenCalledOnce();
    expect(receiptModel.create).toHaveBeenCalledOnce();
  });

  // prove transport and persistence failures fabricate nothing
  it.each(["proof", "receipt"] as const)(
    "rolls back %s failure with check-in and receipt state",
    async (failure) => {
      const evaluator: LeaderboardAutomaticCandidateProofEvaluator =
        // inject proof or post-proof persistence failure
        async () => {
          checkins.push({ id: 1 });
          // fail before receipt finalization
          if (failure === "proof") {
            throw new Error("proof failed");
          }
          failReceiptUpdate = true;
          return {
            checkinId: 1,
            credited: true,
            disposition: "final",
            outcome: "credited",
          };
        };

      await expect(submit(terminalCandidate(), evaluator)).rejects.toThrow(
        failure === "proof" ? "proof failed" : "receipt update failed"
      );
      expect(storedReceipts).toHaveLength(0);
      expect(checkins).toHaveLength(0);
    }
  );

  // prove receipt persistence excludes plaintext candidate semantics
  it("stores only the privacy-minimal receipt shape", async () => {
    const candidate = terminalCandidate();
    await submit(candidate, creditingProof());
    const createValues = receiptModel.create.mock.calls[0][0];
    const storedValues = Object.values(createValues);

    expect(Object.keys(createValues).sort()).toEqual(
      [
        "attemptCount",
        "candidateKey",
        "checkinId",
        "enrollmentId",
        "expiresAt",
        "outcome",
        "payloadDigest",
        "serverPolicyGeneration",
        "state",
      ].sort()
    );
    expect(storedValues).not.toContain(candidate.candidateId);
    expect(storedValues).not.toContain(candidate.latitudeE7);
    expect(storedValues).not.toContain(candidate.longitudeE7);
    expect(storedValues).not.toContain(candidate.accuracyMillimeters);
    expect(storedValues).not.toContain(candidate.terminalId);

    const vessel = vesselCandidate({ candidateId: candidateId("B") });
    await submit(vessel, creditingProof());
    const vesselValues = Object.values(receiptModel.create.mock.calls[1][0]);
    expect(vesselValues).not.toContain(vessel.vesselId);
    expect(vesselValues).not.toContain(vessel.sailingId);
  });

  // prove safe cleanup retains boundary-minus-one and deletes equality
  it("prunes only at the conservative database-time boundary", async () => {
    await submit(terminalCandidate(), creditingProof());
    const expiresAtMs = storedReceipts[0].expiresAt.getTime();

    databaseNowMs = expiresAtMs - 1;
    await expect(
      pruneExpiredLeaderboardAutomaticCandidateReceipts()
    ).resolves.toBe(0);
    expect(storedReceipts).toHaveLength(1);

    databaseNowMs = expiresAtMs;
    await expect(
      pruneExpiredLeaderboardAutomaticCandidateReceipts()
    ).resolves.toBe(1);
    expect(storedReceipts).toHaveLength(0);
  });
});

// cover enrollment cleanup dependency tightening
describe("automatic receipt retention migration", () => {
  // prove retention follows the enrollment expiry marker
  it("uses migration 008 after the expiry lifecycle migration", () => {
    const expiryMigration =
      require.resolve("../../server/migrations/20260817000700-add-expiry-observed-at-to-leaderboard-automatic-enrollments.js");
    const receiptMigration =
      require.resolve("../../server/migrations/20260817000800-restrict-automatic-receipt-enrollment-deletion.js");
    expect(expiryMigration).toContain("20260817000700");
    expect(receiptMigration).toContain("20260817000800");
    expect(expiryMigration < receiptMigration).toBe(true);
  });

  // prove generic enrollment cleanup cannot cascade retained receipts
  it("replaces the enrollment foreign key with restrict", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await retentionMigration.up(queryInterface, DataTypes);

    expect(queryInterface.removeConstraint).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      "LeaderboardAutomaticCandidateReceipts_enrollmentId_fkey",
      { transaction }
    );
    expect(queryInterface.addConstraint).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      expect.objectContaining({
        fields: ["enrollmentId"],
        onDelete: "RESTRICT",
        type: "foreign key",
      })
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove migration failures do not leave a partial foreign key
  it("rolls back foreign key replacement failures", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.addConstraint.mockRejectedValueOnce(new Error("add failed"));

    await expect(retentionMigration.up(queryInterface)).rejects.toThrow(
      "add failed"
    );
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});

// cover exact final replay schema changes
describe("automatic receipt replay generation migration", () => {
  // prove populated final rows backfill under the immutable guard
  it("backfills finals and enforces final-only safe generations", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await replayGenerationMigration.up(queryInterface, DataTypes);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      "serverPolicyGeneration",
      expect.objectContaining({ allowNull: true, type: DataTypes.BIGINT }),
      { transaction }
    );
    const migrationSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(migrationSql).toContain(
      "DISABLE TRIGGER protect_leaderboard_automatic_receipt_update_trigger"
    );
    expect(migrationSql).toContain(
      "WHERE \"name\" = 'automaticLeaderboardCheckins'"
    );
    expect(migrationSql).toContain("WHERE \"state\" <> 'retryable'");
    expect(migrationSql).toContain(
      "ENABLE TRIGGER protect_leaderboard_automatic_receipt_update_trigger"
    );
    expect(migrationSql).toContain(
      "ADD CONSTRAINT leaderboard_auto_receipt_policy_generation"
    );
    expect(migrationSql).toContain('"serverPolicyGeneration" IS NOT NULL');
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove migration failures restore the guarded original schema
  it("rolls back partial replay generation migration", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.sequelize.query.mockRejectedValueOnce(
      new Error("backfill failed")
    );

    await expect(
      replayGenerationMigration.up(queryInterface, DataTypes)
    ).rejects.toThrow("backfill failed");
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  // prove rollback removes only the replay generation shape
  it("removes the generation constraint before its column", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await replayGenerationMigration.down(queryInterface);

    expect(queryInterface.removeConstraint).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      "leaderboard_auto_receipt_policy_generation",
      { transaction }
    );
    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      "serverPolicyGeneration",
      { transaction }
    );
    expect(
      queryInterface.removeConstraint.mock.invocationCallOrder[0]
    ).toBeLessThan(queryInterface.removeColumn.mock.invocationCallOrder[0]);
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
});
