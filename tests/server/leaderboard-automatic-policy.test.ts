import { beforeEach, describe, expect, it, vi } from "vitest";

// hoist database seams
const database = vi.hoisted(() => ({ transaction: vi.fn() }));
// hoist feature flag seams
const featureFlags = vi.hoisted(() => ({ findOrCreate: vi.fn() }));
// hoist allowlist seams
const allowlist = vi.hoisted(() => ({ findOne: vi.fn() }));
// hoist profile seams
const profiles = vi.hoisted(() => ({ findOne: vi.fn() }));
// hoist enrollment seams
const enrollments = vi.hoisted(() => ({ findAll: vi.fn() }));
// hoist receipt seams
const receipts = vi.hoisted(() => ({ findAll: vi.fn() }));
// hoist presence seams
const presences = vi.hoisted(() => ({
  findAll: vi.fn(),
  findOrCreate: vi.fn(),
}));
// hoist check-in seams
const checkins = vi.hoisted(() => ({ findAll: vi.fn() }));

// bind database seams
vi.mock("~/lib/db", () => ({ db: database }));
// bind feature flag seams
vi.mock("~/models/FeatureFlag", () => ({ FeatureFlag: featureFlags }));
// bind allowlist seams
vi.mock("~/models/FeatureFlagAllowlist", () => ({
  FeatureFlagAllowlist: allowlist,
}));
// bind profile seams
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profiles,
}));
// bind enrollment seams
vi.mock("~/models/LeaderboardAutomaticEnrollment", () => ({
  LeaderboardAutomaticEnrollment: enrollments,
}));
// bind receipt seams
vi.mock("~/models/LeaderboardAutomaticCandidateReceipt", () => ({
  LeaderboardAutomaticCandidateReceipt: receipts,
}));
// bind presence seams
vi.mock("~/models/LeaderboardTerminalPresence", () => ({
  LeaderboardTerminalPresence: presences,
}));
// bind check-in seams
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));

import {
  advanceServerPolicyGeneration,
  AUTOMATIC_LEADERBOARD_CHECKINS_FLAG,
  evaluateLeaderboardAutomaticPolicy,
  hasHealthyAutomaticEnrollment,
  LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS,
  LEADERBOARDS_FLAG,
  type LockedLeaderboardAutomaticPolicy,
  lockLeaderboardAutomaticPolicy,
  lockLeaderboardAutomaticProofState,
  withLeaderboardAutomaticPolicyTransaction,
} from "../../server/lib/leaderboardAutomaticPolicy";

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const now = new Date("2026-08-17T20:00:00.000Z");

// build fresh transaction attempts around real policy locks
const preparePolicyTransactionAttempts = (): Array<{
  LOCK: { UPDATE: string };
  attempt: number;
}> => {
  const transactions: Array<{
    LOCK: { UPDATE: string };
    attempt: number;
  }> = [];
  featureFlags.findOrCreate.mockImplementation(({ where }) => [
    {
      enabled: false,
      killSwitch: false,
      name: where.name,
      // complete the row lock
      reload: vi.fn(),
      serverPolicyGeneration: 0,
    },
  ]);
  // expose every fresh database transaction
  database.transaction.mockImplementation(async (callback) => {
    const nextTransaction = {
      LOCK: { UPDATE: "UPDATE" },
      attempt: transactions.length + 1,
    };
    transactions.push(nextTransaction);
    return await callback(nextTransaction);
  });
  return transactions;
};

// wrap one retryable database sqlstate
const retryableTransactionError = (
  code: "40001" | "40P01"
): Error & Record<string, unknown> => {
  const error = new Error(`forced ${code}`) as Error & Record<string, unknown>;

  // exercise separate sequelize error chains
  if (code === "40001") {
    error.original = { code };
  } else {
    error.cause = { parent: { code } };
  }

  return error;
};

// build one mutable policy fixture
const policyFixture = (
  overrides: Partial<LockedLeaderboardAutomaticPolicy> = {}
): LockedLeaderboardAutomaticPolicy => {
  const automaticFlag = {
    enabled: true,
    killSwitch: false,
    serverPolicyGeneration: 4,
    // mutate fixture generations
    update: vi.fn(function (this: Record<string, unknown>, values) {
      Object.assign(this, values);
    }),
  };
  return {
    automaticAllowlisted: false,
    automaticFlag,
    checkins: [],
    enrollments: [
      {
        detectorEnabled: true,
        health: "healthy",
        revokedAt: null,
        tokenExpiresAt: new Date(now.getTime() + 1),
      },
    ],
    parentAllowlisted: false,
    parentFlag: { enabled: true, killSwitch: false },
    presences: [],
    profile: {
      automaticCheckinsEnabled: true,
      optedOut: false,
    },
    receipts: [],
    transaction,
    ...overrides,
  } as unknown as LockedLeaderboardAutomaticPolicy;
};

// cover automatic policy rules
describe("leaderboard automatic policy", () => {
  // reset policy model seams
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // prove exact lock ordering
  it("locks rows in the one parent-to-checkin order", async () => {
    const calls: string[] = [];
    // record feature row locks
    featureFlags.findOrCreate.mockImplementation(({ where }) => [
      {
        enabled: false,
        killSwitch: false,
        name: where.name,
        // record each flag reload
        reload: () => calls.push(`flag:${where.name}`),
        serverPolicyGeneration: 0,
      },
    ]);
    // record allowlist reads
    allowlist.findOne.mockImplementation(({ where }) => {
      calls.push(`allowlist:${where.name}`);
      return null;
    });
    // record profile locks
    profiles.findOne.mockImplementation(() => {
      calls.push("profile");
      return null;
    });
    // record enrollment locks
    enrollments.findAll.mockImplementation(() => {
      calls.push("enrollment");
      return [{ enrollmentId: "enrollment-1" }];
    });
    // record receipt locks
    receipts.findAll.mockImplementation(() => {
      calls.push("receipt");
      return [];
    });
    // record presence locks
    presences.findAll.mockImplementation(() => {
      calls.push("presence");
      return [];
    });
    // record check-in locks
    checkins.findAll.mockImplementation(() => {
      calls.push("checkin");
      return [];
    });

    await lockLeaderboardAutomaticPolicy(transaction as never, {
      lockCheckins: true,
      lockPresence: true,
      lockReceipts: true,
      subject: "auth0|person",
    });

    expect(calls).toEqual([
      `flag:${LEADERBOARDS_FLAG}`,
      `flag:${AUTOMATIC_LEADERBOARD_CHECKINS_FLAG}`,
      `allowlist:${LEADERBOARDS_FLAG}`,
      `allowlist:${AUTOMATIC_LEADERBOARD_CHECKINS_FLAG}`,
      "profile",
      "enrollment",
      "receipt",
      "presence",
      "checkin",
    ]);
  });

  // retry both transaction rollback sqlstates from fresh locks
  it.each(["40001", "40P01"] as const)(
    "retries %s once in a fresh policy transaction",
    async (code) => {
      const transactions = preparePolicyTransactionAttempts();
      let callbackAttempts = 0;

      const result = await withLeaderboardAutomaticPolicyTransaction(
        {},
        (policy) => {
          callbackAttempts += 1;

          // fail only the first complete policy attempt
          if (callbackAttempts === 1) {
            return Promise.reject(retryableTransactionError(code));
          }

          return Promise.resolve(policy.transaction);
        }
      );

      expect(callbackAttempts).toBe(2);
      expect(database.transaction).toHaveBeenCalledTimes(2);
      expect(featureFlags.findOrCreate).toHaveBeenCalledTimes(4);
      expect(transactions.map(({ attempt }) => attempt)).toEqual([1, 2]);
      expect(transactions[0]).not.toBe(transactions[1]);
      expect(result).toBe(transactions[1]);
    }
  );

  // stop retrying at the exported attempt bound
  it("exhausts retryable failures at the exact transaction attempt bound", async () => {
    const transactions = preparePolicyTransactionAttempts();
    const failure = retryableTransactionError("40001");
    let callbackAttempts = 0;

    await expect(
      withLeaderboardAutomaticPolicyTransaction({}, () => {
        callbackAttempts += 1;
        return Promise.reject(failure);
      })
    ).rejects.toBe(failure);

    expect(callbackAttempts).toBe(
      LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS
    );
    expect(database.transaction).toHaveBeenCalledTimes(
      LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS
    );
    expect(transactions).toHaveLength(
      LEADERBOARD_AUTOMATIC_TRANSACTION_MAX_ATTEMPTS
    );
  });

  // never retry unrelated database failures
  it("does not retry a nonretryable transaction failure", async () => {
    const transactions = preparePolicyTransactionAttempts();
    const failure = Object.assign(new Error("unique violation"), {
      original: { code: "23505" },
    });
    let callbackAttempts = 0;

    await expect(
      withLeaderboardAutomaticPolicyTransaction({}, () => {
        callbackAttempts += 1;
        return Promise.reject(failure);
      })
    ).rejects.toBe(failure);

    expect(callbackAttempts).toBe(1);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(transactions).toHaveLength(1);
  });

  // prove post-receipt proof lock ordering
  it("creates and locks presence before check-ins only after a receipt exists", async () => {
    const calls: string[] = [];
    const presence = {
      terminalId: "7",
      // record the definitive row lock
      reload: vi.fn(() => {
        calls.push("presence");
      }),
    };
    presences.findOrCreate.mockImplementation(() => [presence]);
    checkins.findAll.mockImplementation(() => {
      calls.push("checkin");
      return [];
    });
    const missingReceipt = policyFixture();

    await expect(
      lockLeaderboardAutomaticProofState(missingReceipt, {
        createPresence: true,
        lockCheckins: true,
        lockPresence: true,
        subject: "auth0|person",
        terminalId: "7",
      })
    ).rejects.toThrow("receipt lock unavailable");
    expect(presences.findOrCreate).not.toHaveBeenCalled();

    const policy = policyFixture({ receipts: [{ id: 1 }] as never });
    const proofState = await lockLeaderboardAutomaticProofState(policy, {
      createPresence: true,
      lockCheckins: true,
      lockPresence: true,
      subject: "auth0|person",
      terminalId: "7",
    });

    expect(calls).toEqual(["presence", "checkin"]);
    expect(proofState.presences).toEqual([presence]);
    expect(proofState.checkins).toEqual([]);
  });

  // prove effective precedence
  it("enforces parent, automatic, profile, enrollment, and detector precedence", () => {
    expect(
      evaluateLeaderboardAutomaticPolicy(policyFixture(), now)
    ).toMatchObject({ automaticEnabled: true, manualEnabled: true });
    expect(
      evaluateLeaderboardAutomaticPolicy(
        policyFixture({
          parentFlag: { enabled: true, killSwitch: true } as never,
        }),
        now
      )
    ).toMatchObject({ automaticEnabled: false, manualEnabled: false });
    expect(
      evaluateLeaderboardAutomaticPolicy(
        policyFixture({
          automaticFlag: {
            enabled: true,
            killSwitch: true,
            serverPolicyGeneration: 4,
          } as never,
        }),
        now
      )
    ).toMatchObject({ automaticEnabled: false, manualEnabled: true });
    expect(
      evaluateLeaderboardAutomaticPolicy(
        policyFixture({ profile: { optedOut: true } as never }),
        now
      )
    ).toMatchObject({ automaticEnabled: false, manualEnabled: false });
    expect(
      evaluateLeaderboardAutomaticPolicy(
        policyFixture({
          profile: { automaticCheckinsEnabled: false } as never,
        }),
        now
      ).automaticEnabled
    ).toBe(false);
    expect(
      evaluateLeaderboardAutomaticPolicy(
        policyFixture({
          enrollments: [
            {
              detectorEnabled: false,
              health: "healthy",
              revokedAt: null,
              tokenExpiresAt: new Date(now.getTime() + 1),
            },
          ] as never,
        }),
        now
      ).automaticEnabled
    ).toBe(false);
  });

  // prove enrollment health boundaries
  it("requires a healthy unrevoked unexpired detector enrollment", () => {
    expect(hasHealthyAutomaticEnrollment(policyFixture(), now)).toBe(true);

    // reject each unhealthy boundary
    for (const enrollment of [
      {
        detectorEnabled: true,
        health: "degraded",
        revokedAt: null,
        tokenExpiresAt: new Date(now.getTime() + 1),
      },
      {
        detectorEnabled: true,
        health: "healthy",
        revokedAt: now,
        tokenExpiresAt: new Date(now.getTime() + 1),
      },
      {
        detectorEnabled: true,
        health: "healthy",
        revokedAt: null,
        tokenExpiresAt: now,
      },
    ]) {
      expect(
        hasHealthyAutomaticEnrollment(
          policyFixture({ enrollments: [enrollment] as never }),
          now
        )
      ).toBe(false);
    }
  });

  // prove monotonic generation
  it("advances the server policy generation monotonically", async () => {
    const policy = policyFixture();
    await expect(advanceServerPolicyGeneration(policy)).resolves.toBe(5);
    await expect(advanceServerPolicyGeneration(policy)).resolves.toBe(6);
    expect(policy.automaticFlag.update).toHaveBeenNthCalledWith(
      2,
      { serverPolicyGeneration: 6 },
      { transaction }
    );
  });
});
