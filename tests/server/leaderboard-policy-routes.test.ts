import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// hoist authentication seams
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
// hoist database seams
const database = vi.hoisted(() => ({ transaction: vi.fn() }));
// hoist feature seams
const flags = vi.hoisted(() => ({
  automaticLeaderboardCheckinsEnabledForSubject: vi.fn(),
  leaderboardsEnabledForSubject: vi.fn(),
}));
// hoist policy seams
const policy = vi.hoisted(() => ({
  advanceServerPolicyGeneration: vi.fn(),
  evaluateLeaderboardAutomaticPolicy: vi.fn(),
  hasHealthyAutomaticEnrollment: vi.fn(),
  lockLeaderboardAutomaticPolicy: vi.fn(),
  withLeaderboardAutomaticPolicyTransaction: vi.fn(),
}));
// hoist privacy seams
const privacy = vi.hoisted(() => ({ anonymizeLeaderboardAccount: vi.fn() }));
// hoist check-in seams
const checkins = vi.hoisted(() => ({ create: vi.fn(), findOne: vi.fn() }));
// hoist profile seams
const profiles = vi.hoisted(() => ({ findOrCreate: vi.fn() }));
// hoist presence seams
const presences = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
}));
// hoist route seams
const routes = vi.hoisted(() => ({ getByTerminalId: vi.fn() }));
// hoist terminal seams
const terminals = vi.hoisted(() => ({ getByIndex: vi.fn() }));
// hoist vessel seams
const vessels = vi.hoisted(() => ({ getByIndex: vi.fn() }));
// hoist public leaderboard seams
const publicLeaderboards = vi.hoisted(() => ({
  getPublicLeaderboard: vi.fn(),
  parsePublicLeaderboardPeriod: vi.fn(),
  publicLeaderboardsEnabled: vi.fn(),
}));
// hoist enrollment service seams
const automaticEnrollments = vi.hoisted(() => {
  // model fixed lifecycle failures
  class AutomaticEnrollmentError extends Error {
    code: string;
    status: number;

    // construct one mocked service failure
    constructor(code: string, status: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  return {
    acknowledgeAutomaticEnrollmentRotation: vi.fn(),
    AutomaticEnrollmentError,
    createAutomaticEnrollment: vi.fn(),
    disableAutomaticEnrollments: vi.fn(),
    listAutomaticEnrollments: vi.fn(),
    parseAutomaticEnrollmentBootstrapRequest: vi.fn(),
    parseAutomaticEnrollmentHealthUpdate: vi.fn(),
    parseAutomaticEnrollmentRotationRequest: vi.fn(),
    revokeAutomaticEnrollment: vi.fn(),
    rotateAutomaticEnrollmentCredential: vi.fn(),
    updateAutomaticEnrollmentHealth: vi.fn(),
  };
});

// bind authentication seams
vi.mock("../../server/controllers/api/auth", () => auth);
// bind database seams
vi.mock("~/lib/db", () => ({ db: database }));
// bind feature seams
vi.mock("~/lib/leaderboardFlags", () => flags);
// bind policy seams
vi.mock("~/lib/leaderboardAutomaticPolicy", () => policy);
// bind privacy seams
vi.mock("~/lib/leaderboardPrivacy", () => privacy);
// bind leaderboard helpers
vi.mock("~/lib/leaderboards", () => import("../../server/lib/leaderboards"));
// bind check-in seams
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));
// bind profile seams
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profiles,
}));
// bind presence seams
vi.mock("~/models/LeaderboardTerminalPresence", () => ({
  LeaderboardTerminalPresence: presences,
}));
// bind route seams
vi.mock("~/models/Route", () => ({ Route: routes }));
// bind terminal seams
vi.mock("~/models/Terminal", () => ({ Terminal: terminals }));
// bind vessel seams
vi.mock("~/models/Vessel", () => ({ Vessel: vessels }));
// bind public leaderboard seams
vi.mock("~/services/public/leaderboards", () => publicLeaderboards);
// bind enrollment service seams
vi.mock(
  "~/services/leaderboardAutomaticEnrollment",
  () => automaticEnrollments
);

import { leaderboardRouter } from "../../server/controllers/api/leaderboards";

const transaction = { LOCK: { UPDATE: "UPDATE" } };

// mount authenticated policy routes
const app = (): express.Express => {
  const value = express();
  value.use(express.json());
  value.use("/leaderboards", leaderboardRouter);
  // expose route failures
  value.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      // preserve express error signature
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      // redact route failure details
      response.status(599).send({
        error: error instanceof Error ? error.message : "unknown error",
      })
  );
  return value;
};

// cover leaderboard policy routes
describe("leaderboard policy routes", () => {
  let enrollment: Record<string, unknown> & {
    update: ReturnType<typeof vi.fn>;
  };
  let lockedPolicy: Record<string, unknown>;
  let presence: Record<string, unknown> & {
    reload: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let profile: Record<string, unknown> & { update: ReturnType<typeof vi.fn> };

  // reset route policy seams
  beforeEach(() => {
    vi.clearAllMocks();
    enrollment = {
      detectorEnabled: true,
      health: "healthy",
      revokedAt: null,
      tokenExpiresAt: new Date(Date.now() + 60_000),
      // mutate enrollment fixtures
      update: vi.fn((update) => Object.assign(enrollment, update)),
    };
    profile = {
      automaticCheckinsEnabled: false,
      displayName: "Pilot",
      notificationsEnabled: false,
      optedOut: false,
      // mutate profile fixtures
      update: vi.fn((update) => Object.assign(profile, update)),
      useFullName: false,
      verboseNotificationsEnabled: false,
    };
    presence = {
      exitedAt: null,
      lastCreditedAt: null,
      lastObservedAt: null,
      reload: vi.fn(),
      // mutate presence fixtures
      update: vi.fn((update) => Object.assign(presence, update)),
    };
    lockedPolicy = {
      enrollments: [enrollment],
      profile,
      transaction,
    };
    // attach the authenticated subject
    auth.requireAuth.mockImplementation((_request, response, next) => {
      response.locals.user = { sub: "auth0|person" };
      next();
    });
    flags.leaderboardsEnabledForSubject.mockResolvedValue(true);
    flags.automaticLeaderboardCheckinsEnabledForSubject.mockResolvedValue(true);
    policy.evaluateLeaderboardAutomaticPolicy.mockReturnValue({
      manualEnabled: true,
    });
    policy.hasHealthyAutomaticEnrollment.mockReturnValue(false);
    policy.advanceServerPolicyGeneration.mockResolvedValue(1);
    policy.lockLeaderboardAutomaticPolicy.mockResolvedValue(lockedPolicy);
    // execute policy transactions inline
    policy.withLeaderboardAutomaticPolicyTransaction.mockImplementation(
      async (_options, callback) => await callback(lockedPolicy)
    );
    // execute database transactions inline
    database.transaction.mockImplementation(
      async (callback) => await callback(transaction)
    );
    profiles.findOrCreate.mockResolvedValue([profile]);
    presences.findOrCreate.mockResolvedValue([presence]);
    terminals.getByIndex.mockReturnValue({
      location: { latitude: 47.6, longitude: -122.4 },
    });
    routes.getByTerminalId.mockReturnValue({ route: { crossingTime: 20 } });
    checkins.create.mockResolvedValue({ id: 1 });
    const parseBootstrap =
      automaticEnrollments.parseAutomaticEnrollmentBootstrapRequest;
    const parseHealth =
      automaticEnrollments.parseAutomaticEnrollmentHealthUpdate;
    const parseRotation =
      automaticEnrollments.parseAutomaticEnrollmentRotationRequest;
    const rotate = automaticEnrollments.rotateAutomaticEnrollmentCredential;
    const acknowledge =
      automaticEnrollments.acknowledgeAutomaticEnrollmentRotation;
    // accept strict enrollment request fixtures
    parseBootstrap.mockImplementation(
      // preserve submitted bootstrap data
      (body) => body
    );
    parseHealth.mockImplementation(
      // preserve submitted health data
      (body) => body
    );
    parseRotation.mockImplementation(
      // preserve submitted rotation data
      (body) => body
    );
    automaticEnrollments.createAutomaticEnrollment.mockResolvedValue({
      enrollmentId: "00000000-0000-4000-8000-000000000001",
    });
    automaticEnrollments.disableAutomaticEnrollments.mockResolvedValue({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 9,
    });
    automaticEnrollments.listAutomaticEnrollments.mockResolvedValue({
      enrollments: [],
      schemaVersion: 1,
      serverPolicyGeneration: 7,
    });
    automaticEnrollments.updateAutomaticEnrollmentHealth.mockResolvedValue({
      enrollment: { enrollmentId: "00000000-0000-4000-8000-000000000001" },
      schemaVersion: 1,
      serverPolicyGeneration: 8,
    });
    automaticEnrollments.revokeAutomaticEnrollment.mockResolvedValue({
      revoked: true,
      serverPolicyGeneration: 9,
    });
    rotate.mockResolvedValue({
      enrollmentId: "00000000-0000-4000-8000-000000000001",
      schemaVersion: 1,
    });
    acknowledge.mockResolvedValue({
      schemaVersion: 1,
      serverPolicyGeneration: 9,
    });
  });

  // preserve authenticated cleanup outside every rollout boundary
  it("disables every enrollment after parent and child access removal", async () => {
    flags.leaderboardsEnabledForSubject.mockResolvedValue(false);
    flags.automaticLeaderboardCheckinsEnabledForSubject.mockResolvedValue(
      false
    );

    await request(app())
      .post("/leaderboards/automatic/disable")
      .send({ expectedSubject: "auth0|person" })
      .expect(200, {
        disabled: true,
        schemaVersion: 1,
        serverPolicyGeneration: 9,
      });

    expect(
      automaticEnrollments.disableAutomaticEnrollments
    ).toHaveBeenCalledWith("auth0|person");
    expect(flags.leaderboardsEnabledForSubject).not.toHaveBeenCalled();
    expect(
      flags.automaticLeaderboardCheckinsEnabledForSubject
    ).not.toHaveBeenCalled();
  });

  // reject a replaced auth subject before account-wide mutation
  it("binds cleanup acknowledgement to the authenticated subject", async () => {
    await request(app())
      .post("/leaderboards/automatic/disable")
      .send({ expectedSubject: "auth0|other" })
      .expect(409, { error: "automatic_cleanup_subject_changed" });
    await request(app())
      .post("/leaderboards/automatic/disable")
      .send({ expectedSubject: "auth0|person", extra: true })
      .expect(400, { error: "invalid_cleanup_request" });

    expect(
      automaticEnrollments.disableAutomaticEnrollments
    ).not.toHaveBeenCalled();
  });

  // prove auth0-only enrollment device management
  it("routes the complete device lifecycle through the enrollment service", async () => {
    const enrollmentId = "00000000-0000-4000-8000-000000000001";
    const bootstrap = { schemaVersion: 1 };
    const health = { schemaVersion: 1 };
    const rotation = { installationNonce: "nonce", schemaVersion: 1 };

    await request(app())
      .post("/leaderboards/automatic/enrollments")
      .send(bootstrap)
      .expect(201, { enrollmentId });
    await request(app())
      .get("/leaderboards/automatic/enrollments")
      .expect(200, {
        enrollments: [],
        schemaVersion: 1,
        serverPolicyGeneration: 7,
      });
    await request(app())
      .put(`/leaderboards/automatic/enrollments/${enrollmentId}/health`)
      .send(health)
      .expect(200);
    await request(app())
      .post(`/leaderboards/automatic/enrollments/${enrollmentId}/rotate`)
      .send(rotation)
      .expect(200);
    await request(app())
      .post(
        `/leaderboards/automatic/enrollments/${enrollmentId}/rotation/acknowledge`
      )
      .send(rotation)
      .expect(200);
    await request(app())
      .delete(`/leaderboards/automatic/enrollments/${enrollmentId}`)
      .expect(204);

    expect(automaticEnrollments.createAutomaticEnrollment).toHaveBeenCalledWith(
      "auth0|person",
      bootstrap
    );
    expect(automaticEnrollments.listAutomaticEnrollments).toHaveBeenCalledWith(
      "auth0|person"
    );
    expect(
      automaticEnrollments.updateAutomaticEnrollmentHealth
    ).toHaveBeenCalledWith("auth0|person", enrollmentId, health);
    expect(
      automaticEnrollments.rotateAutomaticEnrollmentCredential
    ).toHaveBeenCalledWith("auth0|person", enrollmentId, "nonce");
    expect(
      automaticEnrollments.acknowledgeAutomaticEnrollmentRotation
    ).toHaveBeenCalledWith("auth0|person", enrollmentId, "nonce");
    expect(automaticEnrollments.revokeAutomaticEnrollment).toHaveBeenCalledWith(
      "auth0|person",
      enrollmentId
    );
  });

  // enforce the independent subject rollout on every automatic route
  it("rejects automatic enrollment outside the child subject policy", async () => {
    flags.automaticLeaderboardCheckinsEnabledForSubject.mockResolvedValue(
      false
    );

    await request(app())
      .post("/leaderboards/automatic/enrollments")
      .send({ schemaVersion: 1 })
      .expect(404);
    await request(app())
      .put("/leaderboards/preferences")
      .send({ automaticCheckinsEnabled: true })
      .expect(404);

    expect(
      automaticEnrollments.createAutomaticEnrollment
    ).not.toHaveBeenCalled();
    expect(profile.update).not.toHaveBeenCalled();
  });

  // prove route failures stay fixed and data-free
  it("normalizes invalid and fixed enrollment lifecycle failures", async () => {
    const parseBootstrap =
      automaticEnrollments.parseAutomaticEnrollmentBootstrapRequest;
    parseBootstrap.mockReturnValueOnce(null);
    await request(app())
      .post("/leaderboards/automatic/enrollments")
      .send({ rawCandidate: "must-not-cross" })
      .expect(400, { error: "invalid_enrollment_request" });
    expect(
      automaticEnrollments.createAutomaticEnrollment
    ).not.toHaveBeenCalled();

    automaticEnrollments.listAutomaticEnrollments.mockRejectedValueOnce(
      new automaticEnrollments.AutomaticEnrollmentError(
        "automatic_policy_disabled",
        403
      )
    );
    await request(app())
      .get("/leaderboards/automatic/enrollments")
      .expect(403, { error: "automatic_policy_disabled" });
  });

  // prove generic preference gating
  it("allows disable but requires healthy enrollment for generic enablement", async () => {
    await request(app())
      .put("/leaderboards/preferences")
      .send({ automaticCheckinsEnabled: true })
      .expect(400, {
        error: "Automatic check-ins require a healthy native enrollment",
      });
    expect(profile.update).not.toHaveBeenCalled();

    policy.hasHealthyAutomaticEnrollment.mockReturnValue(true);
    const enabled = await request(app())
      .put("/leaderboards/preferences")
      .send({ automaticCheckinsEnabled: true })
      .expect(200);
    expect(enabled.body).toMatchObject({ automaticCheckinsEnabled: true });

    policy.hasHealthyAutomaticEnrollment.mockReturnValue(false);
    const disabled = await request(app())
      .put("/leaderboards/preferences")
      .send({ automaticCheckinsEnabled: false })
      .expect(200);
    expect(disabled.body).toMatchObject({ automaticCheckinsEnabled: false });
    expect(enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        detectorEnabled: false,
        health: "disabled",
        revokedAt: expect.any(Date),
      }),
      { transaction }
    );
    expect(policy.advanceServerPolicyGeneration).toHaveBeenCalledTimes(2);
  });

  // prove opt-out credential revocation
  it("revokes enrollment and disables automatic participation on opt-out", async () => {
    profile.automaticCheckinsEnabled = true;

    const response = await request(app())
      .put("/leaderboards/preferences")
      .send({ optedOut: true })
      .expect(200);
    expect(response.body).toMatchObject({
      automaticCheckinsEnabled: false,
      optedOut: true,
    });

    expect(enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        detectorEnabled: false,
        health: "disabled",
        revokedAt: expect.any(Date),
      }),
      { transaction }
    );
    expect(policy.advanceServerPolicyGeneration).toHaveBeenCalledOnce();
  });

  // prove policy-only generation changes
  it("does not advance policy generation for display-only preferences", async () => {
    await request(app())
      .put("/leaderboards/preferences")
      .send({ displayName: "Next Pilot" })
      .expect(200);

    expect(profile.update).toHaveBeenCalledWith(
      { displayName: "Next Pilot" },
      { transaction }
    );
    expect(policy.advanceServerPolicyGeneration).not.toHaveBeenCalled();
  });

  // prove manual event chronology
  it("uses observed event time and rejects equal terminal chronology", async () => {
    const entryAt = new Date(Date.now() - 10_000);
    const entry = {
      accuracyMeters: 10,
      latitude: 47.6,
      longitude: -122.4,
      observedAt: entryAt.toISOString(),
      terminalId: "7",
    };

    const first = await request(app())
      .post("/leaderboards/checkins/terminals")
      .send(entry);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toEqual({ credited: true });
    expect(checkins.create).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: entryAt }),
      { transaction }
    );
    expect(presence.update).toHaveBeenCalledWith(
      {
        exitedAt: null,
        lastCreditedAt: entryAt,
        lastObservedAt: entryAt,
      },
      { transaction }
    );

    await request(app())
      .post("/leaderboards/checkins/terminals")
      .send(entry)
      .expect(422, { credited: false, reason: "STALE_LOCATION" });
    expect(checkins.create).toHaveBeenCalledOnce();

    const exitAt = new Date(entryAt.getTime() + 1_000);
    await request(app())
      .post("/leaderboards/presence/terminals")
      .send({
        ...entry,
        latitude: 47.61,
        observedAt: exitAt.toISOString(),
      })
      .expect(200, { recorded: true });
    expect(presence.update).toHaveBeenLastCalledWith(
      { exitedAt: exitAt, lastObservedAt: exitAt },
      { transaction }
    );
  });

  // preserve the exact foreground freshness and response contract
  it("keeps manual terminal shapes at the five-minute freshness boundary", async () => {
    const now = new Date("2026-08-18T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // restore the real clock after boundary requests
    try {
      policy.evaluateLeaderboardAutomaticPolicy.mockReturnValue({
        automaticEnabled: false,
        manualEnabled: true,
      });
      const exactBoundary = {
        accuracyMeters: 10,
        latitude: 47.6,
        longitude: -122.4,
        observedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
        terminalId: "7",
      };

      await request(app())
        .post("/leaderboards/checkins/terminals")
        .send(exactBoundary)
        .expect(201, { credited: true });

      presence.exitedAt = null;
      presence.lastCreditedAt = null;
      presence.lastObservedAt = null;
      checkins.create.mockClear();
      await request(app())
        .post("/leaderboards/checkins/terminals")
        .send({
          ...exactBoundary,
          observedAt: new Date(now.getTime() - 5 * 60_000 - 1).toISOString(),
        })
        .expect(422, { credited: false, reason: "STALE_LOCATION" });
      expect(checkins.create).not.toHaveBeenCalled();

      presence.exitedAt = null;
      presence.lastCreditedAt = new Date(now.getTime() - 60 * 60_000);
      presence.lastObservedAt = presence.lastCreditedAt;
      await request(app())
        .post("/leaderboards/presence/terminals")
        .send({
          ...exactBoundary,
          latitude: 47.61,
          observedAt: now.toISOString(),
        })
        .expect(200, { recorded: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
