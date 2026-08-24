import { Router } from "express";
import { Transaction } from "sequelize";
import type {
  AutomaticEnrollmentDisableRequestV1,
  ForegroundTerminalCheckInRequest,
  ForegroundTerminalCheckInResult,
  ForegroundTerminalPresenceResult,
  LeaderboardCheckInStatus,
  LeaderboardPreferences,
  LeaderboardPreferencesUpdate,
  VesselCheckInRequest,
  VesselCheckInResult,
} from "shared/contracts/leaderboards";
import { isObject } from "shared/lib/objects";

import coastlineSnapshot from "~/data/noaa-enc-harbour-puget-sound.json";
import { db } from "~/lib/db";
import {
  advanceServerPolicyGeneration,
  evaluateLeaderboardAutomaticPolicy,
  hasHealthyAutomaticEnrollment,
  lockLeaderboardAutomaticPolicy,
  withLeaderboardAutomaticPolicyTransaction,
} from "~/lib/leaderboardAutomaticPolicy";
import {
  automaticLeaderboardCheckinsEnabledForSubject,
  leaderboardsEnabledForSubject,
} from "~/lib/leaderboardFlags";
import { anonymizeLeaderboardAccount } from "~/lib/leaderboardPrivacy";
import {
  evaluateTerminalEligibility,
  hasActiveTerminalCheckin,
  isDefinitelyInsideTerminalGeofence,
  isDefinitelyNearVessel,
  isDefinitelyOutsideTerminalGeofence,
  isLocationAccurateEnough,
  normalizeLeaderboardDisplayName,
  stableSailingId,
} from "~/lib/leaderboards";
import {
  type CoastlineSnapshot,
  evaluateOffshoreEligibility,
} from "~/lib/noaaCoastline";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";
import {
  acknowledgeAutomaticEnrollmentRotation,
  AutomaticEnrollmentError,
  createAutomaticEnrollment,
  disableAutomaticEnrollments,
  listAutomaticEnrollments,
  parseAutomaticEnrollmentBootstrapRequest,
  parseAutomaticEnrollmentHealthUpdate,
  parseAutomaticEnrollmentRotationRequest,
  revokeAutomaticEnrollment,
  rotateAutomaticEnrollmentCredential,
  updateAutomaticEnrollmentHealth,
} from "~/services/leaderboardAutomaticEnrollment";
import {
  getPublicLeaderboard,
  parsePublicLeaderboardPeriod,
  publicLeaderboardsEnabled,
} from "~/services/public/leaderboards";

import { requireAuth } from "./auth";

const leaderboardRouter = Router();
const MAX_FUTURE_LOCATION_MS = 60_000;
const MAX_LOCATION_AGE_MS = 5 * 60_000;
const noaaCoastlineSnapshot = coastlineSnapshot as CoastlineSnapshot;

const getProfile = async (
  subject: string,
  transaction?: Transaction
): Promise<LeaderboardProfile> => {
  const [profile] = await LeaderboardProfile.findOrCreate({
    defaults: {
      automaticCheckinsEnabled: false,
      displayName: "",
      notificationsEnabled: true,
      optedOut: false,
      supporterBadgePreferenceSet: false,
      supporterBadgeVisible: true,
      subject,
      useFullName: false,
      verboseNotificationsEnabled: false,
    },
    transaction,
    where: { subject },
  });
  if (transaction) {
    await profile.reload({ lock: transaction.LOCK.UPDATE, transaction });
  }
  return profile;
};

// serialize stored preferences
const serializePreferences = (
  profile: LeaderboardProfile
): LeaderboardPreferences => ({
  automaticCheckinsEnabled: profile.automaticCheckinsEnabled,
  displayName: profile.displayName,
  notificationsEnabled: profile.notificationsEnabled,
  optedOut: profile.optedOut,
  // default unconfigured badge consent on
  supporterBadgeVisible: profile.supporterBadgePreferenceSet
    ? profile.supporterBadgeVisible
    : true,
  useFullName: profile.useFullName,
  verboseNotificationsEnabled: profile.verboseNotificationsEnabled,
});

// validate preference mutations
const sanitizePreferences = (
  input: unknown
): { update: LeaderboardPreferencesUpdate; valid: boolean } => {
  if (!isObject(input)) {
    return { update: {}, valid: false };
  }
  const update: LeaderboardPreferencesUpdate = {};
  const hasDisplayName = "displayName" in input;
  const hasInitials = "initials" in input;
  if (hasDisplayName && hasInitials) {
    return { update: {}, valid: false };
  }
  const label = hasDisplayName ? input.displayName : input.initials;
  // validate an optional public label
  if (label !== undefined) {
    // require a string label
    if (typeof label !== "string") {
      return { update: {}, valid: false };
    }
    const displayName = normalizeLeaderboardDisplayName(label);
    // reject unsafe labels
    if (displayName === null) {
      return { update: {}, valid: false };
    }
    update.displayName = displayName;
  }
  // validate each boolean preference
  for (const key of [
    "automaticCheckinsEnabled",
    "notificationsEnabled",
    "optedOut",
    "supporterBadgeVisible",
    "useFullName",
    "verboseNotificationsEnabled",
  ] as const) {
    // copy only submitted preferences
    if (key in input) {
      // require boolean preference values
      if (typeof input[key] !== "boolean") {
        return { update: {}, valid: false };
      }
      update[key] = input[key];
    }
  }
  return { update, valid: true };
};

const shortestCrossingMinutes = (terminalId: string): number | null => {
  const durations = Object.values(Route.getByTerminalId(terminalId))
    .map((route) => route.crossingTime)
    .filter((value) => Number.isFinite(value) && value > 0);
  return durations.length === 0 ? null : Math.min(...durations);
};

const parseLocation = (
  input: unknown
): ForegroundTerminalCheckInRequest | null => {
  if (!isObject(input) || typeof input.terminalId !== "string") {
    return null;
  }
  const { accuracyMeters, latitude, longitude, observedAt, terminalId } = input;
  if (
    typeof accuracyMeters !== "number" ||
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    typeof observedAt !== "string" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { accuracyMeters, latitude, longitude, observedAt, terminalId };
};

const parseVesselCheckin = (input: unknown): VesselCheckInRequest | null => {
  if (
    !isObject(input) ||
    typeof input.vesselId !== "string" ||
    typeof input.sailingId !== "string"
  ) {
    return null;
  }
  const location = parseLocation({ ...input, terminalId: "vessel" });
  return location
    ? { ...location, sailingId: input.sailingId, vesselId: input.vesselId }
    : null;
};

const locationTimeReason = (
  observedAt: string,
  now: Date
): "FUTURE_LOCATION" | "STALE_LOCATION" | null => {
  const timestamp = Date.parse(observedAt);
  if (
    !Number.isFinite(timestamp) ||
    now.getTime() - timestamp > MAX_LOCATION_AGE_MS
  ) {
    return "STALE_LOCATION";
  }
  return timestamp - now.getTime() > MAX_FUTURE_LOCATION_MS
    ? "FUTURE_LOCATION"
    : null;
};

const rejectDisabledLeaderboard = (
  response: import("express").Response
): void => {
  response.set("X-Robots-Tag", "noindex").status(404).send();
};

/** Public rankings are global-only: private allowlists must never affect SEO. */
const requirePublicLeaderboards = async (
  _request: import("express").Request,
  response: import("express").Response,
  next: import("express").NextFunction
): Promise<void> => {
  response.set("Cache-Control", "no-store");
  if (!(await publicLeaderboardsEnabled())) {
    rejectDisabledLeaderboard(response);
    return;
  }
  next();
};

leaderboardRouter.get(
  "/terminals/:terminalId",
  requirePublicLeaderboards,
  async (request, response) => {
    const period = parsePublicLeaderboardPeriod(request.query.period ?? "all");
    if (!period) {
      return response.status(400).send({ error: "Invalid leaderboard period" });
    }
    return response.send(
      await getPublicLeaderboard({
        entityId: request.params.terminalId,
        kind: "terminal",
        period,
      })
    );
  }
);

leaderboardRouter.get(
  "/vessels/:vesselId",
  requirePublicLeaderboards,
  async (request, response) => {
    const period = parsePublicLeaderboardPeriod(request.query.period ?? "all");
    if (!period) {
      return response.status(400).send({ error: "Invalid leaderboard period" });
    }
    return response.send(
      await getPublicLeaderboard({
        entityId: request.params.vesselId,
        kind: "vessel",
        period,
      })
    );
  }
);

// authenticate every private leaderboard route
leaderboardRouter.use(requireAuth);

// prevent private response caching
leaderboardRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

// disable all owned native credentials outside rollout admission
leaderboardRouter.post("/automatic/disable", async (request, response) => {
  // require one exact transient authenticated-owner binding
  if (
    !isObject(request.body) ||
    Object.keys(request.body).length !== 1 ||
    typeof request.body.expectedSubject !== "string" ||
    !request.body.expectedSubject ||
    request.body.expectedSubject.length > 512
  ) {
    response.status(400).send({ error: "invalid_cleanup_request" });
    return;
  }
  const { expectedSubject } =
    request.body as AutomaticEnrollmentDisableRequestV1;
  // reject token replacement before mutating either subject
  if (expectedSubject !== response.locals.user.sub) {
    response.status(409).send({ error: "automatic_cleanup_subject_changed" });
    return;
  }
  response.send(await disableAutomaticEnrollments(expectedSubject));
});

// enforce subject feature access
leaderboardRouter.use(async (_request, response, next) => {
  // subject feature guard
  if (!(await leaderboardsEnabledForSubject(response.locals.user.sub))) {
    rejectDisabledLeaderboard(response);
    return;
  }
  next();
});

// require the child automatic subject policy for native enrollment routes
leaderboardRouter.use("/automatic", async (_request, response, next) => {
  // fail closed outside the automatic rollout subject set
  if (
    !(await automaticLeaderboardCheckinsEnabledForSubject(
      response.locals.user.sub
    ))
  ) {
    rejectDisabledLeaderboard(response);
    return;
  }
  next();
});

// normalize fixed enrollment lifecycle failures
const sendAutomaticEnrollmentFailure = (
  error: unknown,
  response: import("express").Response
): import("express").Response => {
  // expose only fixed enrollment codes
  if (error instanceof AutomaticEnrollmentError) {
    return response.status(error.status).send({ error: error.code });
  }
  throw error;
};

// create one auth0-bound native enrollment
leaderboardRouter.post("/automatic/enrollments", async (request, response) => {
  const parsed = parseAutomaticEnrollmentBootstrapRequest(request.body);
  // reject malformed bootstrap bytes
  if (!parsed) {
    return response.status(400).send({ error: "invalid_enrollment_request" });
  }

  // normalize fixed lifecycle failures
  try {
    return response
      .status(201)
      .send(await createAutomaticEnrollment(response.locals.user.sub, parsed));
  } catch (error) {
    // redact lifecycle failure details
    return sendAutomaticEnrollmentFailure(error, response);
  }
});

// list privacy-minimal auth0-owned devices
leaderboardRouter.get("/automatic/enrollments", async (_request, response) => {
  // normalize fixed lifecycle failures
  try {
    return response.send(
      await listAutomaticEnrollments(response.locals.user.sub)
    );
  } catch (error) {
    // redact lifecycle failure details
    return sendAutomaticEnrollmentFailure(error, response);
  }
});

// update one auth0-owned detector health record
leaderboardRouter.put(
  "/automatic/enrollments/:enrollmentId/health",
  async (request, response) => {
    const parsed = parseAutomaticEnrollmentHealthUpdate(request.body);
    // reject malformed health bytes
    if (!parsed) {
      return response.status(400).send({ error: "invalid_enrollment_request" });
    }

    // normalize fixed lifecycle failures
    try {
      return response.send(
        await updateAutomaticEnrollmentHealth(
          response.locals.user.sub,
          request.params.enrollmentId,
          parsed
        )
      );
    } catch (error) {
      // redact lifecycle failure details
      return sendAutomaticEnrollmentFailure(error, response);
    }
  }
);

// rotate one auth0-owned credential
leaderboardRouter.post(
  "/automatic/enrollments/:enrollmentId/rotate",
  async (request, response) => {
    const parsed = parseAutomaticEnrollmentRotationRequest(request.body);
    // reject malformed rotation bytes
    if (!parsed) {
      return response.status(400).send({ error: "invalid_enrollment_request" });
    }

    // normalize fixed lifecycle failures
    try {
      return response.send(
        await rotateAutomaticEnrollmentCredential(
          response.locals.user.sub,
          request.params.enrollmentId,
          parsed.installationNonce
        )
      );
    } catch (error) {
      // redact lifecycle failure details
      return sendAutomaticEnrollmentFailure(error, response);
    }
  }
);

// acknowledge one auth0-owned credential rotation
leaderboardRouter.post(
  "/automatic/enrollments/:enrollmentId/rotation/acknowledge",
  async (request, response) => {
    const parsed = parseAutomaticEnrollmentRotationRequest(request.body);
    // reject malformed acknowledgement bytes
    if (!parsed) {
      return response.status(400).send({ error: "invalid_enrollment_request" });
    }

    // normalize fixed lifecycle failures
    try {
      return response.send(
        await acknowledgeAutomaticEnrollmentRotation(
          response.locals.user.sub,
          request.params.enrollmentId,
          parsed.installationNonce
        )
      );
    } catch (error) {
      // redact lifecycle failure details
      return sendAutomaticEnrollmentFailure(error, response);
    }
  }
);

// revoke one auth0-owned enrollment
leaderboardRouter.delete(
  "/automatic/enrollments/:enrollmentId",
  async (request, response) => {
    // normalize fixed lifecycle failures
    try {
      await revokeAutomaticEnrollment(
        response.locals.user.sub,
        request.params.enrollmentId
      );
      return response.status(204).send();
    } catch (error) {
      // redact lifecycle failure details
      return sendAutomaticEnrollmentFailure(error, response);
    }
  }
);

leaderboardRouter.delete("/account", async (request, response) => {
  await db.transaction((transaction: Transaction) =>
    anonymizeLeaderboardAccount(response.locals.user.sub, transaction)
  );
  return response.status(204).send();
});

leaderboardRouter.get(
  "/checkins/terminals/:terminalId/status",
  async (request, response) => {
    const presence = await LeaderboardTerminalPresence.findOne({
      where: {
        subject: response.locals.user.sub,
        terminalId: request.params.terminalId,
      },
    });
    const status: LeaderboardCheckInStatus = {
      checkedIn: Boolean(presence && hasActiveTerminalCheckin(presence)),
    };
    return response.send(status);
  }
);

leaderboardRouter.get(
  "/checkins/vessels/:vesselId/status",
  async (request, response) => {
    const vessel = Vessel.getByIndex(request.params.vesselId);
    const sailingId = vessel ? stableSailingId(vessel) : null;
    const checkin = sailingId
      ? await LeaderboardCheckin.findOne({
          where: {
            kind: "vessel",
            sailingId,
            subject: response.locals.user.sub,
          },
        })
      : null;
    const status: LeaderboardCheckInStatus = { checkedIn: Boolean(checkin) };
    return response.send(status);
  }
);

// credit one verified manual vessel event
leaderboardRouter.post("/checkins/vessels", async (request, response) => {
  const checkin = parseVesselCheckin(request.body);
  if (!checkin) {
    return response
      .status(400)
      .send({ error: "Invalid vessel check-in payload" });
  }
  const now = new Date();
  const timeReason = locationTimeReason(checkin.observedAt, now);
  if (timeReason) {
    const result: VesselCheckInResult = { credited: false, reason: timeReason };
    return response.status(422).send(result);
  }
  if (!isLocationAccurateEnough(checkin.accuracyMeters)) {
    const result: VesselCheckInResult = {
      credited: false,
      reason: "LOCATION_ACCURACY_TOO_LOW",
    };
    return response.status(422).send(result);
  }
  const vessel = Vessel.getByIndex(checkin.vesselId);
  const sailingId = vessel ? stableSailingId(vessel, now.getTime()) : null;
  if (!vessel || !sailingId || sailingId !== checkin.sailingId) {
    const result: VesselCheckInResult = {
      credited: false,
      reason: "UNKNOWN_OR_UNSTABLE_SAILING",
    };
    return response.status(422).send(result);
  }
  if (
    !isDefinitelyNearVessel(checkin, vessel.location, checkin.accuracyMeters)
  ) {
    const result: VesselCheckInResult = {
      credited: false,
      reason: "NOT_NEAR_LIVE_VESSEL",
    };
    return response.status(422).send(result);
  }
  const offshore = evaluateOffshoreEligibility(
    checkin,
    checkin.accuracyMeters,
    noaaCoastlineSnapshot
  );
  if (!offshore.eligible) {
    const result: VesselCheckInResult = {
      credited: false,
      reason: offshore.reason,
    };
    return response.status(422).send(result);
  }
  // serialize manual vessel credit
  const result = await db.transaction(async (transaction: Transaction) => {
    const policy = await lockLeaderboardAutomaticPolicy(transaction, {
      createProfile: true,
      lockCheckins: true,
      sailingId,
      subject: response.locals.user.sub,
    });
    // recheck manual policy while locked
    if (!evaluateLeaderboardAutomaticPolicy(policy, now).manualEnabled) {
      return {
        status: 403,
        body: { error: "Leaderboard participation is disabled" },
      };
    }
    const existing = await LeaderboardCheckin.findOne({
      transaction,
      where: { kind: "vessel", sailingId, subject: response.locals.user.sub },
    });
    if (existing) {
      return {
        status: 200,
        body: {
          credited: false,
          reason: "SAILING_ALREADY_CREDITED",
          sailingId,
        },
      };
    }
    await LeaderboardCheckin.create(
      {
        entityId: vessel.id,
        kind: "vessel",
        occurredAt: now,
        sailingId,
        subject: response.locals.user.sub,
      },
      { transaction }
    );
    return { status: 201, body: { credited: true, sailingId } };
  });
  return response.status(result.status).send(result.body);
});

leaderboardRouter.get("/preferences", async (request, response) =>
  response.send(
    serializePreferences(await getProfile(response.locals.user.sub))
  )
);

// update preferences under policy locks
leaderboardRouter.put("/preferences", async (request, response) => {
  const sanitized = sanitizePreferences(request.body);
  if (!sanitized.valid) {
    return response
      .status(400)
      .send({ error: "Invalid leaderboard preferences" });
  }
  // require the child rollout before any generic automatic enable request
  if (
    sanitized.update.automaticCheckinsEnabled === true &&
    !(await automaticLeaderboardCheckinsEnabledForSubject(
      response.locals.user.sub
    ))
  ) {
    rejectDisabledLeaderboard(response);
    return;
  }
  const now = new Date();
  const result = await withLeaderboardAutomaticPolicyTransaction(
    { createProfile: true, subject: response.locals.user.sub },
    // mutate one locked profile
    async (policy) => {
      const profile = policy.profile as LeaderboardProfile;
      const requestedAutomatic = sanitized.update.automaticCheckinsEnabled;

      // require native health before generic enablement
      if (
        requestedAutomatic === true &&
        !hasHealthyAutomaticEnrollment(policy, now)
      ) {
        return {
          error: "Automatic check-ins require a healthy native enrollment",
          status: 400,
        } as const;
      }

      const optedOut = sanitized.update.optedOut ?? profile.optedOut;
      const update: LeaderboardPreferencesUpdate & {
        supporterBadgePreferenceSet?: boolean;
      } = {
        ...sanitized.update,
        ...(optedOut ? { automaticCheckinsEnabled: false } : {}),
        // remember one explicit badge choice
        ...(sanitized.update.supporterBadgeVisible === undefined
          ? {}
          : { supporterBadgePreferenceSet: true }),
      };
      const policyChanged =
        (update.optedOut !== undefined &&
          update.optedOut !== profile.optedOut) ||
        (update.automaticCheckinsEnabled !== undefined &&
          update.automaticCheckinsEnabled !== profile.automaticCheckinsEnabled);
      let enrollmentRevoked = false;

      // revoke native credentials on any account-wide automatic disable
      if (optedOut || requestedAutomatic === false) {
        // visit each locked enrollment
        for (const enrollment of policy.enrollments) {
          // preserve already-revoked rows
          if (enrollment.revokedAt === null) {
            enrollmentRevoked = true;
            await enrollment.update(
              {
                detectorEnabled: false,
                health: "disabled",
                healthUpdatedAt: now,
                revokedAt: now,
              },
              { transaction: policy.transaction }
            );
          }
        }
      }

      await profile.update(update, { transaction: policy.transaction });

      // advance only server policy mutations
      if (policyChanged || enrollmentRevoked) {
        await advanceServerPolicyGeneration(policy);
      }

      return {
        preferences: serializePreferences(profile),
        status: 200,
      } as const;
    }
  );

  // return one generic preference result
  if ("error" in result) {
    return response.status(result.status).send({ error: result.error });
  }

  return response.status(result.status).send(result.preferences);
});

// record one verified manual terminal exit
leaderboardRouter.post("/presence/terminals", async (request, response) => {
  const location = parseLocation(request.body);
  if (!location) {
    return response
      .status(400)
      .send({ error: "Invalid foreground location payload" });
  }
  const now = new Date();
  const eventAt = new Date(location.observedAt);
  const timeReason = locationTimeReason(location.observedAt, now);
  if (timeReason) {
    const result: ForegroundTerminalPresenceResult = {
      recorded: false,
      reason: timeReason,
    };
    return response.status(422).send(result);
  }
  if (!isLocationAccurateEnough(location.accuracyMeters)) {
    const result: ForegroundTerminalPresenceResult = {
      recorded: false,
      reason: "LOCATION_ACCURACY_TOO_LOW",
    };
    return response.status(422).send(result);
  }
  const terminal = Terminal.getByIndex(location.terminalId);
  if (!terminal) {
    const result: ForegroundTerminalPresenceResult = {
      recorded: false,
      reason: "TERMINAL_NOT_FOUND",
    };
    return response.status(404).send(result);
  }
  if (
    !isDefinitelyOutsideTerminalGeofence(
      location,
      terminal.location,
      location.accuracyMeters
    )
  ) {
    const result: ForegroundTerminalPresenceResult = {
      recorded: false,
      reason: "NOT_OUTSIDE_GEOFENCE",
    };
    return response.status(422).send(result);
  }
  // serialize manual terminal exit
  const result = await db.transaction(async (transaction: Transaction) => {
    const policy = await lockLeaderboardAutomaticPolicy(transaction, {
      createProfile: true,
      lockPresence: true,
      subject: response.locals.user.sub,
      terminalId: location.terminalId,
    });

    // recheck manual policy while locked
    if (!evaluateLeaderboardAutomaticPolicy(policy, now).manualEnabled) {
      return { recorded: false };
    }

    const [presence] = await LeaderboardTerminalPresence.findOrCreate({
      defaults: {
        exitedAt: null,
        lastCreditedAt: null,
        lastObservedAt: null,
        subject: response.locals.user.sub,
        terminalId: location.terminalId,
      },
      transaction,
      where: {
        subject: response.locals.user.sub,
        terminalId: location.terminalId,
      },
    });
    await presence.reload({ lock: transaction.LOCK.UPDATE, transaction });

    // reject chronology reversal and equality
    if (
      presence.lastObservedAt &&
      eventAt.getTime() <= presence.lastObservedAt.getTime()
    ) {
      return { recorded: false, reason: "STALE_LOCATION" } as const;
    }

    // require an active entry before exit
    if (!presence.lastCreditedAt || presence.exitedAt) {
      return { recorded: false };
    }
    await presence.update(
      { exitedAt: eventAt, lastObservedAt: eventAt },
      { transaction }
    );
    return { recorded: true };
  });
  return response.send(result);
});

// credit one verified manual terminal entry
leaderboardRouter.post("/checkins/terminals", async (request, response) => {
  const location = parseLocation(request.body);
  if (!location) {
    return response
      .status(400)
      .send({ error: "Invalid foreground location payload" });
  }
  const now = new Date();
  const eventAt = new Date(location.observedAt);
  const timeReason = locationTimeReason(location.observedAt, now);
  if (timeReason) {
    const result: ForegroundTerminalCheckInResult = {
      credited: false,
      reason: timeReason,
    };
    return response.status(422).send(result);
  }
  if (!isLocationAccurateEnough(location.accuracyMeters)) {
    const result: ForegroundTerminalCheckInResult = {
      credited: false,
      reason: "LOCATION_ACCURACY_TOO_LOW",
    };
    return response.status(422).send(result);
  }
  const terminal = Terminal.getByIndex(location.terminalId);
  if (!terminal) {
    const result: ForegroundTerminalCheckInResult = {
      credited: false,
      reason: "TERMINAL_NOT_FOUND",
    };
    return response.status(404).send(result);
  }
  const inside = isDefinitelyInsideTerminalGeofence(
    location,
    terminal.location,
    location.accuracyMeters
  );
  const outside = isDefinitelyOutsideTerminalGeofence(
    location,
    terminal.location,
    location.accuracyMeters
  );
  if (!inside && !outside) {
    const result: ForegroundTerminalCheckInResult = {
      credited: false,
      reason: "LOCATION_UNCERTAIN",
    };
    return response.status(422).send(result);
  }
  const crossingMinutes = shortestCrossingMinutes(location.terminalId);
  if (crossingMinutes === null) {
    return response
      .status(503)
      .send({ error: "Terminal route data is warming" });
  }
  // serialize manual terminal entry
  const result = await db.transaction(async (transaction: Transaction) => {
    const policy = await lockLeaderboardAutomaticPolicy(transaction, {
      createProfile: true,
      lockPresence: true,
      subject: response.locals.user.sub,
      terminalId: location.terminalId,
    });
    const profile = policy.profile as LeaderboardProfile;

    // recheck manual policy while locked
    if (!evaluateLeaderboardAutomaticPolicy(policy, now).manualEnabled) {
      return {
        status: 403,
        body: { error: "Leaderboard participation is disabled" },
      };
    }
    const [presence] = await LeaderboardTerminalPresence.findOrCreate({
      defaults: {
        exitedAt: null,
        lastCreditedAt: null,
        lastObservedAt: null,
        subject: response.locals.user.sub,
        terminalId: location.terminalId,
      },
      transaction,
      where: {
        subject: response.locals.user.sub,
        terminalId: location.terminalId,
      },
    });
    await presence.reload({ lock: transaction.LOCK.UPDATE, transaction });

    // reject chronology reversal and equality
    if (
      presence.lastObservedAt &&
      eventAt.getTime() <= presence.lastObservedAt.getTime()
    ) {
      return {
        status: 422,
        body: { credited: false, reason: "STALE_LOCATION" },
      };
    }

    // process a verified exit event
    if (outside) {
      // close an active presence
      if (presence.lastCreditedAt && !presence.exitedAt) {
        await presence.update(
          { exitedAt: eventAt, lastObservedAt: eventAt },
          { transaction }
        );
      }
      return {
        status: 200,
        body: { credited: false, reason: "OUTSIDE_GEOFENCE" },
      };
    }
    const eligibility = evaluateTerminalEligibility(
      presence,
      eventAt,
      crossingMinutes
    );
    // return the current eligibility denial
    if (!eligibility.eligible) {
      return {
        status: 200,
        body: {
          ...(eligibility.cooldownEndsAt
            ? { cooldownEndsAt: eligibility.cooldownEndsAt.toISOString() }
            : {}),
          credited: false,
          reason: eligibility.reason,
        },
      };
    }
    await LeaderboardCheckin.create(
      {
        entityId: location.terminalId,
        kind: "terminal",
        occurredAt: eventAt,
        subject: response.locals.user.sub,
      },
      { transaction }
    );
    await presence.update(
      {
        exitedAt: null,
        lastCreditedAt: eventAt,
        lastObservedAt: eventAt,
      },
      { transaction }
    );
    return {
      status: 201,
      body: {
        credited: true,
        notification: profile.notificationsEnabled
          ? {
              action: "replace",
              kind: "checkin",
              terminalId: location.terminalId,
            }
          : undefined,
      },
    };
  });
  return response.status(result.status).send(result.body);
});

export { leaderboardRouter };
