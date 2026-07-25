import { Router } from "express";
import { Op, Transaction } from "sequelize";
import type {
  ForegroundTerminalCheckInRequest,
  ForegroundTerminalCheckInResult,
  ForegroundTerminalPresenceResult,
  LeaderboardCheckInStatus,
  LeaderboardPeriod,
  LeaderboardPreferences,
  LeaderboardPreferencesUpdate,
  VesselCheckInRequest,
  VesselCheckInResult,
} from "shared/contracts/leaderboards";
import { isObject } from "shared/lib/objects";

import coastlineSnapshot from "~/data/noaa-enc-harbour-puget-sound.json";
import { db } from "~/lib/db";
import { leaderboardsEnabled } from "~/lib/leaderboardFlags";
import { anonymizeLeaderboardAccount } from "~/lib/leaderboardPrivacy";
import {
  evaluateTerminalEligibility,
  hasActiveTerminalCheckin,
  isDefinitelyInsideTerminalGeofence,
  isDefinitelyNearVessel,
  isDefinitelyOutsideTerminalGeofence,
  isLocationAccurateEnough,
  leaderboardLabel,
  limitLeaderboardRanks,
  normalizeLeaderboardDisplayName,
  periodStart,
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

import { assignAuthUser, requireAuth } from "./auth";

const leaderboardRouter = Router();
const MAX_FUTURE_LOCATION_MS = 60_000;
const MAX_LOCATION_AGE_MS = 5 * 60_000;
const noaaCoastlineSnapshot = coastlineSnapshot as CoastlineSnapshot;

const getPeriod = (value: unknown): LeaderboardPeriod | null =>
  value === "all" || value === "month" || value === "week" ? value : null;

const getProfile = async (
  subject: string,
  transaction?: Transaction
): Promise<LeaderboardProfile> => {
  const [profile] = await LeaderboardProfile.findOrCreate({
    defaults: {
      automaticCheckinsEnabled: true,
      displayName: "",
      notificationsEnabled: true,
      optedOut: false,
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

const serializePreferences = (
  profile: LeaderboardProfile
): LeaderboardPreferences => ({
  automaticCheckinsEnabled: profile.automaticCheckinsEnabled,
  displayName: profile.displayName,
  notificationsEnabled: profile.notificationsEnabled,
  optedOut: profile.optedOut,
  useFullName: profile.useFullName,
  verboseNotificationsEnabled: profile.verboseNotificationsEnabled,
});

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
  if (label !== undefined) {
    if (typeof label !== "string") {
      return { update: {}, valid: false };
    }
    const displayName = normalizeLeaderboardDisplayName(label);
    if (displayName === null) {
      return { update: {}, valid: false };
    }
    update.displayName = displayName;
  }
  for (const key of [
    "automaticCheckinsEnabled",
    "notificationsEnabled",
    "optedOut",
    "useFullName",
    "verboseNotificationsEnabled",
  ] as const) {
    if (key in input) {
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

leaderboardRouter.use(async (request, response, next) => {
  response.set("Cache-Control", "no-store");
  if (!(await leaderboardsEnabled())) {
    response.set("X-Robots-Tag", "noindex");
    return response.status(404).send();
  }
  next();
});

leaderboardRouter.get("/terminals/:terminalId", async (request, response) => {
  const period = getPeriod(request.query.period ?? "all");
  if (!period) {
    return response.status(400).send({ error: "Invalid leaderboard period" });
  }
  const where = {
    entityId: request.params.terminalId,
    kind: "terminal",
    ...(periodStart(period)
      ? { occurredAt: { [Op.gte]: periodStart(period) } }
      : {}),
  };
  const rows = (await LeaderboardCheckin.findAll({
    attributes: ["subject", [db.fn("COUNT", db.col("id")), "score"]],
    group: ["subject"],
    order: [
      [db.literal('"score"'), "DESC"],
      ["subject", "ASC"],
    ],
    raw: true,
    where,
  })) as unknown as Array<{ score: string | number; subject: string }>;
  const subjects = rows.map((row) => row.subject as string);
  const profiles = subjects.length
    ? await LeaderboardProfile.findAll({
        where: { subject: { [Op.in]: subjects } },
      })
    : [];
  const profileBySubject = new Map(
    profiles.map((profile) => [profile.subject, profile])
  );
  const eligibleRanks = rows
    .map((row) => {
      const profile = profileBySubject.get(row.subject as string);
      if (profile?.optedOut) {
        return null;
      }
      return {
        label: profile
          ? leaderboardLabel(profile.displayName, profile.useFullName)
          : "Anonymous",
        score: Number(row.score),
      };
    })
    .filter((rank): rank is { label: string; score: number } => rank !== null);
  const ranks = limitLeaderboardRanks(eligibleRanks).map((rank, index) => ({
    ...rank,
    rank: index + 1,
  }));
  return response.send({ entityId: request.params.terminalId, period, ranks });
});

leaderboardRouter.get("/vessels/:vesselId", async (request, response) => {
  if (!(await leaderboardsEnabled())) {
    return response.status(404).send();
  }
  const period = getPeriod(request.query.period ?? "all");
  if (!period) {
    return response.status(400).send({ error: "Invalid leaderboard period" });
  }
  const where = {
    entityId: request.params.vesselId,
    kind: "vessel",
    ...(periodStart(period)
      ? { occurredAt: { [Op.gte]: periodStart(period) } }
      : {}),
  };
  const rows = (await LeaderboardCheckin.findAll({
    attributes: ["subject", [db.fn("COUNT", db.col("id")), "score"]],
    group: ["subject"],
    order: [
      [db.literal('"score"'), "DESC"],
      ["subject", "ASC"],
    ],
    raw: true,
    where,
  })) as unknown as Array<{ score: string | number; subject: string }>;
  const profiles = rows.length
    ? await LeaderboardProfile.findAll({
        where: { subject: { [Op.in]: rows.map((row) => row.subject) } },
      })
    : [];
  const profileBySubject = new Map(
    profiles.map((profile) => [profile.subject, profile])
  );
  const eligibleRanks = rows
    .map((row) => {
      const profile = profileBySubject.get(row.subject);
      return profile?.optedOut
        ? null
        : {
            label: profile
              ? leaderboardLabel(profile.displayName, profile.useFullName)
              : "Anonymous",
            score: Number(row.score),
          };
    })
    .filter((rank): rank is { label: string; score: number } => rank !== null);
  const ranks = limitLeaderboardRanks(eligibleRanks).map((rank, index) => ({
    ...rank,
    rank: index + 1,
  }));
  return response.send({ entityId: request.params.vesselId, period, ranks });
});

leaderboardRouter.use(requireAuth, assignAuthUser);

leaderboardRouter.delete("/account", async (request, response) => {
  await db.transaction((transaction: Transaction) =>
    anonymizeLeaderboardAccount(response.locals.user.sub, transaction)
  );
  return response.status(204).send();
});

leaderboardRouter.get(
  "/checkins/terminals/:terminalId/status",
  async (request, response) => {
    if (!(await leaderboardsEnabled())) {
      return response.status(404).send();
    }
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
    if (!(await leaderboardsEnabled())) {
      return response.status(404).send();
    }
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

leaderboardRouter.post("/checkins/vessels", async (request, response) => {
  if (!(await leaderboardsEnabled())) {
    return response.status(404).send();
  }
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
  const result = await db.transaction(async (transaction: Transaction) => {
    const profile = await getProfile(response.locals.user.sub, transaction);
    if (profile.optedOut) {
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

leaderboardRouter.put("/preferences", async (request, response) => {
  const sanitized = sanitizePreferences(request.body);
  if (!sanitized.valid) {
    return response
      .status(400)
      .send({ error: "Invalid leaderboard preferences" });
  }
  const profile = await getProfile(response.locals.user.sub);
  await profile.update(sanitized.update);
  return response.send(serializePreferences(profile));
});

leaderboardRouter.post("/presence/terminals", async (request, response) => {
  if (!(await leaderboardsEnabled())) {
    return response.status(404).send();
  }
  const location = parseLocation(request.body);
  if (!location) {
    return response
      .status(400)
      .send({ error: "Invalid foreground location payload" });
  }
  const now = new Date();
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
  const result = await db.transaction(async (transaction: Transaction) => {
    const [presence] = await LeaderboardTerminalPresence.findOrCreate({
      defaults: {
        exitedAt: null,
        lastCreditedAt: null,
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
    if (!presence.lastCreditedAt || presence.exitedAt) {
      return { recorded: false };
    }
    await presence.update({ exitedAt: now }, { transaction });
    return { recorded: true };
  });
  return response.send(result);
});

leaderboardRouter.post("/checkins/terminals", async (request, response) => {
  if (!(await leaderboardsEnabled())) {
    return response.status(404).send();
  }
  const location = parseLocation(request.body);
  if (!location) {
    return response
      .status(400)
      .send({ error: "Invalid foreground location payload" });
  }
  const now = new Date();
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
  const result = await db.transaction(async (transaction: Transaction) => {
    const profile = await getProfile(response.locals.user.sub, transaction);
    if (profile.optedOut) {
      return {
        status: 403,
        body: { error: "Leaderboard participation is disabled" },
      };
    }
    const [presence] = await LeaderboardTerminalPresence.findOrCreate({
      defaults: {
        exitedAt: null,
        lastCreditedAt: null,
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
    if (outside) {
      if (presence.lastCreditedAt && !presence.exitedAt) {
        await presence.update({ exitedAt: now }, { transaction });
      }
      return {
        status: 200,
        body: { credited: false, reason: "OUTSIDE_GEOFENCE" },
      };
    }
    const eligibility = evaluateTerminalEligibility(
      presence,
      now,
      crossingMinutes
    );
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
        occurredAt: now,
        subject: response.locals.user.sub,
      },
      { transaction }
    );
    await presence.update(
      { exitedAt: null, lastCreditedAt: now },
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
