import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";
import type { LeaderboardPeriod } from "shared/contracts/leaderboards";

export const TERMINAL_GEOFENCE_METERS = 304.8;
export const MAX_LOCATION_ACCURACY_METERS = 100;
export const VESSEL_PROXIMITY_METERS = 250;
export const MAX_VESSEL_STATUS_AGE_MS = 5 * 60_000;

export const MAX_LEADERBOARD_RANKS = 10;

/** Limits the public board after ineligible entries have been removed. */
export const limitLeaderboardRanks = <Rank>(ranks: Rank[]): Rank[] =>
  ranks.slice(0, MAX_LEADERBOARD_RANKS);

export interface LocationPoint {
  latitude: number;
  longitude: number;
}

export const distanceInMeters = (
  left: LocationPoint,
  right: LocationPoint
): number => {
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(left.latitude)) *
      Math.cos(toRadians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const isLocationAccurateEnough = (accuracyMeters: number): boolean =>
  Number.isFinite(accuracyMeters) &&
  accuracyMeters >= 0 &&
  accuracyMeters <= MAX_LOCATION_ACCURACY_METERS;

export const isDefinitelyInsideTerminalGeofence = (
  location: LocationPoint,
  terminal: LocationPoint,
  accuracyMeters: number
): boolean =>
  distanceInMeters(location, terminal) + accuracyMeters <=
  TERMINAL_GEOFENCE_METERS;

export const isDefinitelyOutsideTerminalGeofence = (
  location: LocationPoint,
  terminal: LocationPoint,
  accuracyMeters: number
): boolean =>
  distanceInMeters(location, terminal) - accuracyMeters >
  TERMINAL_GEOFENCE_METERS;

export const cooldownMilliseconds = (shortestCrossingMinutes: number): number =>
  shortestCrossingMinutes * 2 * 60_000;

export const periodStart = (
  period: LeaderboardPeriod,
  now = new Date()
): Date | undefined => {
  const zonedNow = DateTime.fromJSDate(now, { zone: "America/Los_Angeles" });
  if (period === "all") {
    return undefined;
  }
  if (period === "month") {
    return zonedNow.startOf("month").toUTC().toJSDate();
  }
  return zonedNow.startOf("week").toUTC().toJSDate();
};

export const leaderboardLabel = (displayName: string): string => {
  const trimmed = displayName.trim().replace(/\s+/g, " ");
  return trimmed || "Anonymous";
};

/** Maintained, deliberately small policy for public leaderboard labels. */
const reservedLeaderboardLabels = new Set([
  "admin",
  "administrator",
  "anonymous",
  "deleted",
  "ferry fyi",
  "ferryfyi",
  "moderator",
  "support",
  "system",
]);

// Match complete normalized words only; this avoids blocking unrelated names.
const prohibitedLeaderboardWords = new Set([
  "asshole",
  "bitch",
  "cunt",
  "fuck",
  "motherfucker",
  "shit",
]);

const normalizeLabelForPolicy = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(
      /[0134@$]/g,
      (character) =>
        ({ "0": "o", "1": "i", "3": "e", "4": "a", "@": "a", $: "s" })[
          character
        ] ?? character
    );

const hasUnsafeUnicode = (value: string): boolean =>
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u.test(value);

const hasAllowedNameCharacters = (value: string): boolean =>
  /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u.test(value);

/**
 * Normalizes and moderates the public label itself. Callers can submit
 * initials (for example, "AL") instead of a profile name; no account name is
 * read, inferred, or retained by this helper.
 */
export const normalizeLeaderboardDisplayName = (
  value: string
): string | null => {
  if (hasUnsafeUnicode(value)) {
    return null;
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    normalized.length < 1 ||
    normalized.length > 80 ||
    !hasAllowedNameCharacters(normalized)
  ) {
    return null;
  }
  const policyValue = normalizeLabelForPolicy(normalized);
  if (reservedLeaderboardLabels.has(policyValue)) {
    return null;
  }
  return policyValue
    .split(/[ .'-]+/)
    .some((word) => prohibitedLeaderboardWords.has(word))
    ? null
    : normalized;
};

export const anonymizedLeaderboardSubject = (): string =>
  `deleted:${randomUUID()}`;

export interface LiveVesselForCheckin {
  arrivingTerminalId?: number;
  departedTime?: number;
  departingTerminalId?: number;
  id: string;
  inService?: boolean;
  isAtDock?: boolean;
  location?: LocationPoint;
  statusUpdatedAt?: number;
}

/** A sailing must have a fresh, internally consistent WSF status identity. */
export const stableSailingId = (
  vessel: LiveVesselForCheckin,
  now = Date.now()
): string | null => {
  if (
    !vessel.inService ||
    vessel.isAtDock ||
    !vessel.location ||
    !Number.isFinite(vessel.location.latitude) ||
    !Number.isFinite(vessel.location.longitude) ||
    !Number.isFinite(vessel.departedTime) ||
    !Number.isFinite(vessel.departingTerminalId) ||
    !Number.isFinite(vessel.arrivingTerminalId) ||
    vessel.departingTerminalId === vessel.arrivingTerminalId ||
    !Number.isFinite(vessel.statusUpdatedAt) ||
    (vessel.departedTime as number) <= 0 ||
    (vessel.departedTime as number) < now - 12 * 60 * 60_000 ||
    (vessel.departedTime as number) > now + 60_000 ||
    now - (vessel.statusUpdatedAt as number) > MAX_VESSEL_STATUS_AGE_MS ||
    (vessel.statusUpdatedAt as number) > now + 60_000
  ) {
    return null;
  }
  return `${vessel.id}:${vessel.departedTime}:${vessel.departingTerminalId}:${vessel.arrivingTerminalId}`;
};

export const isDefinitelyNearVessel = (
  location: LocationPoint,
  vessel: LocationPoint,
  accuracyMeters: number
): boolean =>
  distanceInMeters(location, vessel) + accuracyMeters <=
  VESSEL_PROXIMITY_METERS;

export interface TerminalEligibilityState {
  exitedAt: Date | null;
  lastCreditedAt: Date | null;
}

/** A terminal check-in remains active until a later verified departure. */
export const hasActiveTerminalCheckin = (
  state: TerminalEligibilityState
): boolean =>
  Boolean(
    state.lastCreditedAt &&
    (!state.exitedAt || state.exitedAt < state.lastCreditedAt)
  );

export interface TerminalEligibilityResult {
  cooldownEndsAt?: Date;
  eligible: boolean;
  reason?: "COOLDOWN" | "MUST_LEAVE_TERMINAL";
}

export const evaluateTerminalEligibility = (
  state: TerminalEligibilityState,
  now: Date,
  shortestCrossingMinutes: number
): TerminalEligibilityResult => {
  if (!state.lastCreditedAt) {
    return { eligible: true };
  }
  if (!state.exitedAt || state.exitedAt <= state.lastCreditedAt) {
    return { eligible: false, reason: "MUST_LEAVE_TERMINAL" };
  }
  const cooldownEndsAt = new Date(
    state.lastCreditedAt.getTime() +
      cooldownMilliseconds(shortestCrossingMinutes)
  );
  return now < cooldownEndsAt
    ? { cooldownEndsAt, eligible: false, reason: "COOLDOWN" }
    : { eligible: true };
};
