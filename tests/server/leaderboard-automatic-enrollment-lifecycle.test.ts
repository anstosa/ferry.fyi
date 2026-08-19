import { createHash, createHmac } from "node:crypto";

import {
  AUTOMATIC_CHECKIN_NATIVE_SCOPES,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
} from "shared/contracts/leaderboards";
import { beforeEach, describe, expect, it, vi } from "vitest";

// hoist enrollment persistence seams
const enrollments = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
}));
// hoist database seams
const database = vi.hoisted(() => ({ transaction: vi.fn() }));
// hoist policy seams
const policyService = vi.hoisted(() => ({
  advanceServerPolicyGeneration: vi.fn(),
  evaluateLeaderboardAutomaticPolicy: vi.fn(),
  getServerPolicyGeneration: vi.fn(),
  lockLeaderboardAutomaticPolicy: vi.fn(),
  withLeaderboardAutomaticPolicyTransaction: vi.fn(),
}));
// hoist durable config seams
const terminalConfig = vi.hoisted(() => ({
  loadCurrentAutomaticTerminalConfig: vi.fn(),
}));

// bind enrollment persistence seams
vi.mock("~/models/LeaderboardAutomaticEnrollment", () => ({
  LeaderboardAutomaticEnrollment: enrollments,
}));
// bind database seams
vi.mock("~/lib/db", () => ({ db: database }));
// bind policy seams
vi.mock("~/lib/leaderboardAutomaticPolicy", () => policyService);
// bind durable config seams
vi.mock("~/services/leaderboardAutomaticNativeConfig", () => terminalConfig);

import {
  acknowledgeAutomaticEnrollmentRotation,
  authenticateAutomaticEnrollmentBearer,
  automaticEnrollmentCleanupEligible,
  AutomaticEnrollmentError,
  cleanupAutomaticEnrollments,
  createAutomaticEnrollment,
  disableAutomaticEnrollments,
  getAuthenticatedAutomaticEnrollmentConfigPolicy,
  parseAutomaticEnrollmentBootstrapRequest,
  parseAutomaticEnrollmentRotationRequest,
  revokeAutomaticEnrollment,
  rotateAutomaticEnrollmentCredential,
  updateAutomaticEnrollmentHealth,
} from "../../server/services/leaderboardAutomaticEnrollment";

const now = new Date("2026-08-18T04:00:00.000Z");
const subject = "auth0|automatic-person";
const enrollmentId = "00000000-0000-4000-8000-000000000001";
const installationNonce = Buffer.alloc(32, 3).toString("base64url");
const pepper = "test-only-enrollment-pepper-32-bytes";
const baseUrl = "https://ferry.example";
const transaction = { LOCK: { UPDATE: "UPDATE" } };

type EnrollmentFixture = Record<string, unknown> & {
  destroy: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

// compute one expected persisted token digest
const digest = (token: string): string =>
  createHmac("sha256", pepper).update(token).digest("hex");

// build one mutable enrollment fixture
const enrollmentFixture = (
  overrides: Record<string, unknown> = {}
): EnrollmentFixture => {
  const enrollment: EnrollmentFixture = {
    capabilityVersion: 1,
    currentTokenDigest: digest(Buffer.alloc(32, 1).toString("base64url")),
    detectorEnabled: true,
    enrollmentId,
    expiryObservedAt: null,
    health: "healthy",
    healthUpdatedAt: now,
    installationNonceHash: createHash("sha256")
      .update(installationNonce)
      .digest("hex"),
    platform: "android",
    predecessorAcknowledgedAt: null,
    predecessorTokenDigest: null,
    predecessorValidUntil: null,
    revokedAt: null,
    scopes: [...AUTOMATIC_CHECKIN_NATIVE_SCOPES],
    subject,
    tokenExpiresAt: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    tokenIssuedAt: now,
    tokenRotatedAt: null,
    // delete one fixture row
    destroy: vi.fn(),
    // mutate one fixture row
    update: vi.fn((values: Record<string, unknown>) => {
      Object.assign(enrollment, values);
      return enrollment;
    }),
    ...overrides,
  };
  return enrollment;
};

// build one mutable locked policy fixture
const policyFixture = (
  enrollment: EnrollmentFixture,
  overrides: Record<string, unknown> = {}
) => {
  const automaticFlag = {
    enabled: true,
    killSwitch: false,
    serverPolicyGeneration: 5,
    // mutate one policy generation
    update: vi.fn((values: Record<string, unknown>) => {
      Object.assign(automaticFlag, values);
    }),
  };
  return {
    automaticAllowlisted: false,
    automaticFlag,
    checkins: [],
    enrollments: [enrollment],
    parentAllowlisted: false,
    parentFlag: { enabled: true, killSwitch: false },
    presences: [],
    profile: { automaticCheckinsEnabled: false, optedOut: false },
    receipts: [],
    transaction,
    ...overrides,
  };
};

// build one strict android bootstrap request
const bootstrapRequest = () => ({
  androidSdkInt: 29,
  capabilityVersion: 1 as const,
  installationNonce,
  platform: "android" as const,
  schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
});

// cover the credential lifecycle
describe("automatic leaderboard enrollment lifecycle", () => {
  let enrollment: EnrollmentFixture;
  let policy: ReturnType<typeof policyFixture>;

  // reset lifecycle seams
  beforeEach(() => {
    vi.clearAllMocks();
    enrollment = enrollmentFixture();
    policy = policyFixture(enrollment);
    terminalConfig.loadCurrentAutomaticTerminalConfig.mockResolvedValue({
      configGeneration: 1,
    });
    policyService.evaluateLeaderboardAutomaticPolicy.mockReturnValue({
      automaticFlagEnabled: true,
      parentFlagEnabled: true,
    });
    policyService.getServerPolicyGeneration.mockImplementation(
      // expose the current mocked generation
      (locked) => locked.automaticFlag.serverPolicyGeneration
    );
    policyService.advanceServerPolicyGeneration.mockImplementation(
      // advance the current mocked generation
      (locked) => {
        locked.automaticFlag.serverPolicyGeneration += 1;
        return locked.automaticFlag.serverPolicyGeneration;
      }
    );
    policyService.withLeaderboardAutomaticPolicyTransaction.mockImplementation(
      // execute one mocked policy transaction
      async (_options, callback) => await callback(policy)
    );
    database.transaction.mockImplementation(
      // execute one mocked database transaction
      async (callback) => await callback(transaction)
    );
    enrollments.create.mockImplementation(
      // persist one generated fixture
      (values) => {
        Object.assign(enrollment, values);
        return enrollment;
      }
    );
    enrollments.findAll.mockResolvedValue([enrollment]);
  });

  // revoke every installation and preference exactly once
  it("disables account-wide enrollment state idempotently", async () => {
    const profile = {
      automaticCheckinsEnabled: true,
      optedOut: false,
      // mutate the locked profile fixture
      update: vi.fn((values: Record<string, unknown>) => {
        Object.assign(profile, values);
        return profile;
      }),
    };
    policy.profile = profile;

    await expect(disableAutomaticEnrollments(subject, now)).resolves.toEqual({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 6,
    });
    await expect(disableAutomaticEnrollments(subject, now)).resolves.toEqual({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 6,
    });

    expect(profile.update).toHaveBeenCalledOnce();
    expect(profile.update).toHaveBeenCalledWith(
      { automaticCheckinsEnabled: false },
      { transaction }
    );
    expect(enrollment.update).toHaveBeenCalledOnce();
    expect(policyService.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove strict platform and rotation parsing
  it("accepts only exact v1 platform-bound enrollment requests", () => {
    expect(
      parseAutomaticEnrollmentBootstrapRequest(bootstrapRequest())
    ).toEqual(bootstrapRequest());
    expect(
      parseAutomaticEnrollmentBootstrapRequest({
        ...bootstrapRequest(),
        deviceModel: "forbidden",
      })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentBootstrapRequest({
        ...bootstrapRequest(),
        installationNonce: "short",
      })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentRotationRequest({
        installationNonce,
        schemaVersion: 1,
      })
    ).toEqual({ installationNonce, schemaVersion: 1 });
    expect(
      parseAutomaticEnrollmentRotationRequest({
        installationNonce,
        rawCandidate: true,
        schemaVersion: 1,
      })
    ).toBeNull();
  });

  // prove one-time bearer issuance and privacy-minimal persistence
  it("requests 32 random bytes and persists only peppered identity", async () => {
    const entropy = Buffer.alloc(32, 7);
    const expectedToken = Buffer.from(entropy).toString("base64url");
    const randomBytes = vi.fn(() => entropy);

    const result = await createAutomaticEnrollment(
      subject,
      bootstrapRequest(),
      {
        baseUrl,
        now,
        pepper,
        randomBytes,
      }
    );

    expect(randomBytes).toHaveBeenCalledOnce();
    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(entropy.equals(Buffer.alloc(32))).toBe(true);
    expect(result).toMatchObject({
      bearerToken: expectedToken,
      enrollmentId,
      scopes: AUTOMATIC_CHECKIN_NATIVE_SCOPES,
      urls: {
        candidates: `${baseUrl}/api/leaderboards/native/candidates`,
        config: `${baseUrl}/api/leaderboards/native/config`,
        enrollment: `${baseUrl}/api/leaderboards/native/enrollment`,
        status: `${baseUrl}/api/leaderboards/native/status`,
      },
    });
    const persisted = enrollments.create.mock.calls[0][0];
    expect(persisted.currentTokenDigest).toBe(digest(expectedToken));
    expect(persisted.installationNonceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(persisted)).not.toContain(expectedToken);
    expect(Object.keys(persisted)).not.toContain("deviceModel");
    expect(Object.keys(persisted)).not.toContain("location");
  });

  // prove readiness fails before credential state changes
  it("fails closed before token issuance when durable config is unavailable", async () => {
    terminalConfig.loadCurrentAutomaticTerminalConfig.mockRejectedValueOnce(
      new Error("hash mismatch with sensitive detail")
    );
    const randomBytes = vi.fn(() => Buffer.alloc(32, 7));

    await expect(
      createAutomaticEnrollment(subject, bootstrapRequest(), {
        baseUrl,
        now,
        pepper,
        randomBytes,
      })
    ).rejects.toMatchObject({
      code: "credential_configuration_unavailable",
      message: "credential_configuration_unavailable",
      status: 503,
    });
    expect(randomBytes).not.toHaveBeenCalled();
    expect(
      policyService.withLeaderboardAutomaticPolicyTransaction
    ).not.toHaveBeenCalled();
    expect(enrollments.create).not.toHaveBeenCalled();
    expect(enrollment.update).not.toHaveBeenCalled();
  });

  // prove the android production support floor
  it("rejects Android below API 29 before readiness or persistence", async () => {
    await expect(
      createAutomaticEnrollment(
        subject,
        { ...bootstrapRequest(), androidSdkInt: 28 },
        { baseUrl, now, pepper }
      )
    ).rejects.toBeInstanceOf(AutomaticEnrollmentError);
    expect(
      terminalConfig.loadCurrentAutomaticTerminalConfig
    ).not.toHaveBeenCalled();
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  // prove exact expiry boundary and exactly-once generation
  it("retires current credentials once at the inclusive expiry boundary", async () => {
    const token = Buffer.alloc(32, 1).toString("base64url");
    enrollment.tokenExpiresAt = now;

    const first = await authenticateAutomaticEnrollmentBearer(
      token,
      "automatic-checkins:status:read",
      { baseUrl, now, pepper }
    );
    const second = await authenticateAutomaticEnrollmentBearer(
      token,
      "automatic-checkins:status:read",
      { baseUrl, now, pepper }
    );

    expect(first).toEqual({
      authenticated: false,
      outcome: "enrollment_expired",
      serverPolicyGeneration: 6,
    });
    expect(second).toEqual({
      authenticated: false,
      outcome: "enrollment_expired",
      serverPolicyGeneration: 6,
    });
    expect(enrollment.update).toHaveBeenCalledOnce();
    expect(enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        detectorEnabled: false,
        expiryObservedAt: now,
        health: "disabled",
      }),
      { transaction }
    );
    expect(policyService.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove fixed auth distinctions and stable opaque limiting
  it("distinguishes unknown and revoked tokens and keeps limiter identity stable", async () => {
    const currentToken = Buffer.alloc(32, 1).toString("base64url");
    const predecessorToken = Buffer.alloc(32, 2).toString("base64url");
    const current = await authenticateAutomaticEnrollmentBearer(
      currentToken,
      "automatic-checkins:status:read",
      { baseUrl, now, pepper }
    );

    enrollment.predecessorTokenDigest = digest(currentToken);
    enrollment.predecessorValidUntil = new Date(now.getTime() + 1000);
    enrollment.currentTokenDigest = digest(predecessorToken);
    const predecessor = await authenticateAutomaticEnrollmentBearer(
      currentToken,
      "automatic-checkins:status:read",
      { baseUrl, now, pepper }
    );
    expect(current.authenticated).toBe(true);
    expect(predecessor.authenticated).toBe(true);
    // compare only authenticated contexts
    if (current.authenticated && predecessor.authenticated) {
      expect(current.context.enrollmentLimiterDigest).toMatch(
        /^[a-f0-9]{64}$/u
      );
      expect(predecessor.context.enrollmentLimiterDigest).toBe(
        current.context.enrollmentLimiterDigest
      );
      expect(current.context.enrollmentLimiterDigest).not.toBe(
        currentToken.toLowerCase()
      );
      expect(current.context.enrollmentLimiterDigest).not.toBe(
        enrollment.currentTokenDigest
      );
      expect(current.context.enrollmentLimiterDigest).not.toBe(enrollmentId);
    }

    enrollments.findAll.mockResolvedValueOnce([]);
    await expect(
      authenticateAutomaticEnrollmentBearer(
        Buffer.alloc(32, 9).toString("base64url"),
        "automatic-checkins:status:read",
        { baseUrl, now, pepper }
      )
    ).resolves.toEqual({
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration: null,
    });

    const revoked = enrollmentFixture({
      currentTokenDigest: digest(predecessorToken),
      revokedAt: now,
    });
    enrollments.findAll.mockResolvedValueOnce([revoked]);
    Object.assign(policy, { enrollments: [revoked] });
    await expect(
      authenticateAutomaticEnrollmentBearer(
        predecessorToken,
        "automatic-checkins:status:read",
        { baseUrl, now, pepper }
      )
    ).resolves.toEqual({
      authenticated: false,
      outcome: "enrollment_revoked",
      serverPolicyGeneration: 5,
    });
  });

  // prove exact scope authorization
  it("rejects cross-used scopes after enrollment recognition", async () => {
    const token = Buffer.alloc(32, 1).toString("base64url");
    enrollment.scopes = ["automatic-checkins:status:read"];

    await expect(
      authenticateAutomaticEnrollmentBearer(
        token,
        "automatic-checkins:candidates:write",
        { baseUrl, now, pepper }
      )
    ).resolves.toEqual({
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration: 5,
    });
  });

  // preserve locked policy disclosure across an enrollment removal race
  it("returns authenticated policy generation when enrollment disappears after prequery", async () => {
    enrollments.findAll.mockResolvedValueOnce([enrollment]);
    policyService.withLeaderboardAutomaticPolicyTransaction.mockImplementationOnce(
      // remove the recognized row before the locked recheck
      async (_options, callback) => {
        policy.enrollments = [];
        return await callback(policy);
      }
    );

    await expect(
      authenticateAutomaticEnrollmentBearer(
        Buffer.alloc(32, 1).toString("base64url"),
        "automatic-checkins:candidates:write",
        { baseUrl, now, pepper }
      )
    ).resolves.toEqual({
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration: 5,
    });
  });

  // prove readiness also gates successor issuance
  it("fails rotation before state changes when config becomes unavailable", async () => {
    enrollment.tokenExpiresAt = new Date(now.getTime() + 1000);
    terminalConfig.loadCurrentAutomaticTerminalConfig.mockRejectedValueOnce(
      new Error("missing durable config")
    );
    const randomBytes = vi.fn(() => Buffer.alloc(32, 8));

    await expect(
      rotateAutomaticEnrollmentCredential(
        subject,
        enrollmentId,
        installationNonce,
        { baseUrl, now, pepper, randomBytes }
      )
    ).rejects.toMatchObject({
      code: "credential_configuration_unavailable",
      status: 503,
    });
    expect(randomBytes).not.toHaveBeenCalled();
    expect(enrollment.update).not.toHaveBeenCalled();
  });

  // prove nonce replay and mismatch revoke their bound identities
  it("revokes replayed and mismatched installation bindings", async () => {
    const replacement = enrollmentFixture({
      enrollmentId: "00000000-0000-4000-8000-000000000002",
    });
    enrollments.create.mockResolvedValueOnce(replacement);

    const credential = await createAutomaticEnrollment(
      subject,
      bootstrapRequest(),
      {
        baseUrl,
        now,
        pepper,
        randomBytes: vi.fn(() => Buffer.alloc(32, 7)),
      }
    );
    expect(credential.enrollmentId).toBe(replacement.enrollmentId);
    expect(enrollment.revokedAt).toEqual(now);

    policy.enrollments = [replacement];
    await expect(
      updateAutomaticEnrollmentHealth(
        subject,
        replacement.enrollmentId as string,
        {
          detectorEnabled: true,
          health: "healthy",
          installationNonce: Buffer.alloc(32, 4).toString("base64url"),
          schemaVersion: 1,
        },
        now
      )
    ).rejects.toMatchObject({ code: "installation_mismatch", status: 409 });
    expect(replacement.revokedAt).toEqual(now);
  });

  // prove bounded rotation and acknowledgement
  it("rotates only when due and ends predecessor overlap on acknowledgement", async () => {
    enrollment.tokenExpiresAt = new Date(now.getTime() + 1000);
    const oldDigest = enrollment.currentTokenDigest;
    const result = await rotateAutomaticEnrollmentCredential(
      subject,
      enrollmentId,
      installationNonce,
      {
        baseUrl,
        now,
        pepper,
        randomBytes: vi.fn(() => Buffer.alloc(32, 8)),
        tokenPolicy: {
          dependencyRetentionMs: 7 * 24 * 60 * 60 * 1000,
          predecessorOverlapMs: 500,
          rotateBeforeMs: 2000,
          tokenTtlMs: 4000,
        },
      }
    );

    expect(result.bearerToken).toBe(Buffer.alloc(32, 8).toString("base64url"));
    expect(enrollment.predecessorTokenDigest).toBe(oldDigest);
    expect(enrollment.predecessorValidUntil).toEqual(
      new Date(now.getTime() + 500)
    );
    expect(enrollment.expiryObservedAt).toBeNull();

    const status = await acknowledgeAutomaticEnrollmentRotation(
      subject,
      enrollmentId,
      installationNonce,
      new Date(now.getTime() + 100)
    );
    expect(enrollment.predecessorAcknowledgedAt).toEqual(
      new Date(now.getTime() + 100)
    );
    expect(enrollment.predecessorValidUntil).toEqual(
      new Date(now.getTime() + 100)
    );
    expect(status.serverPolicyGeneration).toBe(5);
  });

  // prove repeat-safe explicit revocation
  it("advances explicit revocation once", async () => {
    await expect(
      revokeAutomaticEnrollment(subject, enrollmentId, now)
    ).resolves.toEqual({ revoked: true, serverPolicyGeneration: 6 });
    await expect(
      revokeAutomaticEnrollment(subject, enrollmentId, now)
    ).resolves.toEqual({ revoked: false, serverPolicyGeneration: 6 });
    expect(policyService.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove bootstrap policy ignores preference and health
  it("exposes bootstrap-safe config eligibility without a preference loop", async () => {
    enrollment.detectorEnabled = false;
    enrollment.health = "pending";
    policy.profile.automaticCheckinsEnabled = false;

    await expect(
      getAuthenticatedAutomaticEnrollmentConfigPolicy(
        {
          enrollmentId,
          enrollmentLimiterDigest: "a".repeat(64),
          platform: "android",
          scopes: [...AUTOMATIC_CHECKIN_NATIVE_SCOPES],
          serverPolicyGeneration: 5,
          subject,
        },
        now
      )
    ).resolves.toEqual({
      serverPolicyGeneration: 5,
      terminalEnabled: true,
      vesselEnabled: false,
    });
  });

  // prove cleanup rechecks dependencies under ordered policy locks
  it("retains racing receipts and deletes only after lock-ordered recheck", async () => {
    const retiredAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    enrollment.revokedAt = retiredAt;
    enrollments.findAll.mockResolvedValue([enrollment]);
    policy.receipts = [{ id: 1 }];

    await expect(cleanupAutomaticEnrollments({ now })).resolves.toBe(0);
    expect(enrollment.destroy).not.toHaveBeenCalled();
    expect(
      policyService.withLeaderboardAutomaticPolicyTransaction
    ).toHaveBeenCalledWith(
      { enrollmentId, lockReceipts: true, subject },
      expect.any(Function)
    );
    expect(enrollments.findAll.mock.calls[0][0]).not.toHaveProperty("lock");

    policy.receipts = [];
    await expect(cleanupAutomaticEnrollments({ now })).resolves.toBe(1);
    expect(enrollment.destroy).toHaveBeenCalledWith({ transaction });
  });

  // prove the explicit retention predicate
  it("keeps dependency retention inclusive and receipt-safe", () => {
    const retiredAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const row = { revokedAt: retiredAt, tokenExpiresAt: retiredAt };

    expect(automaticEnrollmentCleanupEligible(row, 0, now)).toBe(true);
    expect(automaticEnrollmentCleanupEligible(row, 1, now)).toBe(false);
    expect(
      automaticEnrollmentCleanupEligible(row, 0, new Date(now.getTime() - 1))
    ).toBe(false);
  });
});
