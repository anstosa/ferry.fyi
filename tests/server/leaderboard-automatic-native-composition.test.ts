import express from "express";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  type AutomaticCheckinCandidateV1,
} from "shared/contracts/leaderboards";
import { automaticTerminalRegionContentHashV1 } from "shared/lib/leaderboardAutomaticContracts";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// provide import-time production configuration
const originalEnvironment = vi.hoisted(() => {
  const original = {
    baseUrl: process.env.BASE_URL,
    candidatePepper: process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER,
    tokenPepper: process.env.LEADERBOARD_AUTOMATIC_TOKEN_PEPPER,
  };
  process.env.BASE_URL = "https://ferry.fyi";
  delete process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER;
  delete process.env.LEADERBOARD_AUTOMATIC_TOKEN_PEPPER;
  return original;
});

// hoist the database clock seam
const database = vi.hoisted(() => ({ query: vi.fn() }));
// hoist enrollment service seams
const enrollmentService = vi.hoisted(() => ({
  authenticateAutomaticEnrollmentBearer: vi.fn(),
  automaticEnrollmentNativeUrls: vi.fn(),
  getAuthenticatedAutomaticEnrollmentConfigPolicy: vi.fn(),
  getAuthenticatedAutomaticEnrollmentStatus: vi.fn(),
  nativeRevokeAutomaticEnrollment: vi.fn(),
}));
// hoist the candidate service seams
const candidateService = vi.hoisted(() => ({
  createLeaderboardAutomaticCandidateHandler: vi.fn(),
  handleCandidate: vi.fn(),
}));
// hoist the durable config seam
const configService = vi.hoisted(() => ({
  loadCurrentAutomaticTerminalConfig: vi.fn(),
}));
// hoist the production terminal proof seam
const terminalProofService = vi.hoisted(() => {
  const proofEvaluator = vi.fn();
  return {
    createLeaderboardAutomaticTerminalProofEvaluator: vi.fn(
      // return one stable production evaluator
      () => proofEvaluator
    ),
    proofEvaluator,
  };
});

// bind the database clock seam
vi.mock("~/lib/db", () => ({ db: database }));
// bind enrollment composition seams
vi.mock("~/services/leaderboardAutomaticEnrollment", () => enrollmentService);
// bind candidate composition seams
vi.mock("~/services/leaderboardAutomaticCandidateReceipts", () => ({
  AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS: 60_000,
  createLeaderboardAutomaticCandidateHandler:
    candidateService.createLeaderboardAutomaticCandidateHandler,
}));
// bind durable config composition seams
vi.mock("~/services/leaderboardAutomaticNativeConfig", () => configService);
// bind terminal proof composition seams
vi.mock("~/services/leaderboardAutomaticTerminalProof", () => ({
  AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS: 100_000,
  createLeaderboardAutomaticTerminalProofEvaluator:
    terminalProofService.createLeaderboardAutomaticTerminalProofEvaluator,
}));

import { automaticLeaderboardNativeRouter } from "../../server/controllers/api/leaderboardAutomaticNative";

const TOKEN = "A".repeat(43);
const DATABASE_NOW_MS = 1_720_000_001_000;
const ENROLLMENT_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "auth0|native-production";
const candidate: AutomaticCheckinCandidateV1 = {
  accuracyMillimeters: 25_000,
  candidateId: `${"A".repeat(21)}A`,
  capturedAtMs: 1_720_000_000_000,
  configGeneration: 7,
  kind: "terminal",
  latitudeE7: 473_000_000,
  longitudeE7: -1_225_000_000,
  schemaVersion: 1,
  terminalId: "7",
};
const urls = {
  candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
  config: "https://ferry.fyi/api/leaderboards/native/config",
  enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment",
  status: "https://ferry.fyi/api/leaderboards/native/status",
};
const getConfigPolicy =
  enrollmentService.getAuthenticatedAutomaticEnrollmentConfigPolicy;
const getStatus = enrollmentService.getAuthenticatedAutomaticEnrollmentStatus;
const createCandidateHandler =
  candidateService.createLeaderboardAutomaticCandidateHandler;

// mount the exported production router
const productionApp = (): express.Express => {
  const app = express();
  app.use("/api/leaderboards/native", automaticLeaderboardNativeRouter);
  // preserve ordinary application startup
  app.get("/ordinary", (_request, response) => {
    response.json({ available: true });
  });
  return app;
};

// authorize one native request
const authorize = (): string => `Bearer ${TOKEN}`;

// restore one optional environment value
const restoreEnvironmentValue = (
  key:
    | "BASE_URL"
    | "LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER"
    | "LEADERBOARD_AUTOMATIC_TOKEN_PEPPER",
  value: string | undefined
): void => {
  // remove values absent before the test
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

// verify the exported production router
describe("automatic native production composition", () => {
  // restore process-wide test configuration
  afterAll(() => {
    restoreEnvironmentValue("BASE_URL", originalEnvironment.baseUrl);
    restoreEnvironmentValue(
      "LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER",
      originalEnvironment.candidatePepper
    );
    restoreEnvironmentValue(
      "LEADERBOARD_AUTOMATIC_TOKEN_PEPPER",
      originalEnvironment.tokenPepper
    );
  });

  // reset production service seams
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER;
    delete process.env.LEADERBOARD_AUTOMATIC_TOKEN_PEPPER;
    database.query.mockResolvedValue([{ nowMs: String(DATABASE_NOW_MS) }]);
    enrollmentService.authenticateAutomaticEnrollmentBearer.mockResolvedValue({
      authenticated: true,
      context: {
        enrollmentId: ENROLLMENT_ID,
        enrollmentLimiterDigest: "a".repeat(64),
        platform: "android",
        scopes: [
          "automatic-checkins:config:read",
          "automatic-checkins:status:read",
          "automatic-checkins:candidates:write",
          "automatic-checkins:enrollment:revoke",
        ],
        serverPolicyGeneration: 11,
        subject: SUBJECT,
      },
    });
    enrollmentService.automaticEnrollmentNativeUrls.mockReturnValue(urls);
    getConfigPolicy.mockResolvedValue({
      serverPolicyGeneration: 11,
      terminalEnabled: true,
      vesselEnabled: false,
    });
    getStatus.mockResolvedValue({
      automaticEnabled: false,
      credentialExpiryBucket: "seven_days_or_more",
      rotateRecommended: false,
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    enrollmentService.nativeRevokeAutomaticEnrollment.mockResolvedValue({
      revoked: true,
      schemaVersion: 1,
      serverPolicyGeneration: 12,
    });
    candidateService.handleCandidate.mockResolvedValue({
      credited: false,
      disposition: "final",
      outcome: "detector_disabled",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    // bind a fail-closed handler factory
    createCandidateHandler.mockImplementation(
      ({ candidateKeyPepper }: { candidateKeyPepper: string }) => {
        // reject missing production secrets
        if (candidateKeyPepper.length < 32) {
          throw new Error("private candidate pepper canary");
        }
        return candidateService.handleCandidate;
      }
    );
    const regions = [
      {
        configGeneration: 7,
        latitudeE7: 473_000_000,
        longitudeE7: -1_225_000_000,
        radiusMillimeters: 304_800,
        terminalId: "7",
      },
    ];
    configService.loadCurrentAutomaticTerminalConfig.mockResolvedValue({
      activatedAt: new Date(1_720_000_000_000),
      configGeneration: 7,
      contentHash: await automaticTerminalRegionContentHashV1(regions),
      generatedAt: new Date(1_720_000_000_000),
      regionJson: JSON.stringify(regions),
      regions,
      retainUntil: new Date(1_730_000_000_000),
      schemaVersion: 1,
    });
  });

  // prove every production dependency and fail-closed seam
  it("wires durable config, policy, lifecycle, and receipt services", async () => {
    const app = productionApp();
    await request(app).get("/ordinary").expect(200, { available: true });
    const configResponse = await request(app)
      .get("/api/leaderboards/native/config")
      .set("Authorization", authorize())
      .expect(200);

    expect(configResponse.body).toMatchObject({
      configGeneration: 7,
      detectors: { terminalEnabled: true, vesselEnabled: false },
      parameters: {
        candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
        maxLocationAccuracyMillimeters: 100_000,
      },
      serverPolicyGeneration: 11,
      serverTimeMs: DATABASE_NOW_MS,
      urls,
    });
    expect(database.query).toHaveBeenCalledOnce();
    expect(
      configService.loadCurrentAutomaticTerminalConfig
    ).toHaveBeenCalledWith(undefined, new Date(DATABASE_NOW_MS));
    expect(
      enrollmentService.getAuthenticatedAutomaticEnrollmentConfigPolicy
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: ENROLLMENT_ID,
        subject: SUBJECT,
      }),
      new Date(DATABASE_NOW_MS)
    );
    expect(
      enrollmentService.automaticEnrollmentNativeUrls
    ).toHaveBeenCalledWith();

    const statusResponse = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(200);
    expect(statusResponse.body.automaticEnabled).toBe(false);
    expect(
      enrollmentService.getAuthenticatedAutomaticEnrollmentStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID })
    );

    const revokeResponse = await request(app)
      .delete("/api/leaderboards/native/enrollment")
      .set("Authorization", authorize())
      .expect(200);
    expect(revokeResponse.body).toEqual({
      revoked: true,
      schemaVersion: 1,
      serverPolicyGeneration: 12,
    });
    expect(
      enrollmentService.nativeRevokeAutomaticEnrollment
    ).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID })
    );

    const secretFailure = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(503);
    expect(secretFailure.body).toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    expect(JSON.stringify(secretFailure.body)).not.toContain("pepper");

    process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER = "weak";
    const weakSecretFailure = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(503);
    expect(weakSecretFailure.body).toEqual(secretFailure.body);

    process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER = "p".repeat(32);
    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(200);
    expect(
      candidateService.createLeaderboardAutomaticCandidateHandler
    ).toHaveBeenLastCalledWith({
      candidateKeyPepper: "p".repeat(32),
      proofEvaluator: terminalProofService.proofEvaluator,
    });
    expect(candidateService.handleCandidate).toHaveBeenCalledWith({
      candidate,
      enrollmentId: ENROLLMENT_ID,
      subject: SUBJECT,
    });

    configService.loadCurrentAutomaticTerminalConfig.mockRejectedValueOnce(
      new Error("private durable config canary")
    );
    const configFailure = await request(app)
      .get("/api/leaderboards/native/config")
      .set("Authorization", authorize())
      .expect(500);
    expect(configFailure.body).toEqual({
      error: "internal_error",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    expect(JSON.stringify(configFailure.body)).not.toContain("canary");
  });

  // preserve credentials when the production authentication service rejects
  it("maps production authentication rejection to native retryable service failure", async () => {
    const app = productionApp();
    enrollmentService.authenticateAutomaticEnrollmentBearer.mockRejectedValueOnce(
      new Error("private production authentication canary")
    );
    const candidateResponse = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(503);
    enrollmentService.authenticateAutomaticEnrollmentBearer.mockRejectedValueOnce(
      new Error("private production authentication canary")
    );
    const statusResponse = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(503);

    expect(candidateResponse.body).toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
      schemaVersion: 1,
      serverPolicyGeneration: null,
    });
    expect(statusResponse.body).toEqual({
      error: "internal_error",
      schemaVersion: 1,
      serverPolicyGeneration: null,
    });
    expect(
      JSON.stringify([candidateResponse.body, statusResponse.body])
    ).not.toMatch(/authentication_failed|canary/u);
  });
});
