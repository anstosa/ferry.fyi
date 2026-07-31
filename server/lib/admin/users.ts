import type { AlertRule, AlertSubscriptions } from "shared/contracts/user";

import {
  ApplicationRevocationResult,
  revokeApplicationTokens,
} from "~/lib/admin/sessionRevocation";
import {
  Auth0RevocationResult,
  Auth0UserPage,
  findAuth0UserByExactEmail,
  getAuth0UserEmail,
  listAuth0Users,
  revokeAuth0UserCredentials,
} from "~/lib/auth0Admin";
import { db } from "~/lib/db";
import { anonymizeLeaderboardAccount } from "~/lib/leaderboardPrivacy";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";
import { UserSettings } from "~/models/UserSettings";

export interface DeletedUserDataResult {
  /** Auth0 is the identity provider and is deliberately not modified here. */
  auth0Identity: "retained";
  /** The operation is repeat-safe; zero deleted rows still means complete. */
  status: "complete";
}

/**
 * Removes all Ferry FYI-owned identifying state for a subject.
 *
 * Leaderboard check-ins are the sole retention exception: they are first
 * reassigned to a newly generated, non-linkable subject by the shared privacy
 * service.  Profiles and live terminal presence are removed by that service.
 * User settings contain push tokens and notification subscriptions, so
 * deleting the settings row removes those identifiers as well.  Auth0's user
 * record is intentionally retained and this operation performs no Auth0 call.
 */
export const deleteFerryUserData = async (
  subject: string
): Promise<DeletedUserDataResult> => {
  await db.transaction(async (transaction) => {
    // The revocation watermark must commit with deletion so an old token
    // cannot recreate Ferry FYI data after the identifiers are removed.
    await revokeApplicationTokens(subject, new Date(), transaction);
    await anonymizeLeaderboardAccount(subject, transaction);

    await Promise.all([
      UserSettings.destroy({ transaction, where: { subject } }),
      // A feature-flag allowlist entry is app-owned subject data too; retaining
      // it would re-link a future account session to this deletion.
      FeatureFlagAllowlist.destroy({ transaction, where: { subject } }),
    ]);
  });

  return { auth0Identity: "retained", status: "complete" };
};

export interface ForceSignOutResult {
  applicationTokens: ApplicationRevocationResult;
  auth0: Auth0RevocationResult;
  /** Complete only if all supported Auth0 management operations succeeded. */
  status: "complete" | "partial";
}

/**
 * Invalidates Ferry FYI JWTs immediately and then attempts Auth0 credential and
 * session revocation. Auth0 identity is deliberately retained; neither this
 * service nor its response claims to end the user's Auth0 SSO session.
 */
export const forceSignOutFerryUser = async (
  subject: string
): Promise<ForceSignOutResult> => {
  const applicationTokens = await revokeApplicationTokens(subject);
  const auth0 = await revokeAuth0UserCredentials(subject);
  return {
    applicationTokens,
    auth0,
    status: auth0.status,
  };
};

export interface AdminSupportProfile {
  email?: string;
  leaderboard: {
    checkins: { terminal: number; total: number; vessel: number };
    optedOut: boolean | null;
    profile: {
      automaticCheckinsEnabled: boolean;
      displayName: string;
      notificationsEnabled: boolean;
      optedOut: boolean;
      useFullName: boolean;
      verboseNotificationsEnabled: boolean;
    } | null;
    profileExists: boolean;
    terminalPresenceCount: number;
  };
  settings: {
    alertRules: AlertRule[];
    alertSubscriptions: AlertSubscriptions;
    favoriteRouteIds: string[];
    hasPushToken: boolean;
    subscribedTerminalIds: string[];
    ticketCount: number;
  } | null;
  subject: string;
}

export const listFerryUsers = ({
  page,
  query,
}: {
  page: number;
  query?: string;
}): Promise<Auth0UserPage> => listAuth0Users({ page, pageSize: 25, query });

/**
 * Resolves one selected identity with Ferry FYI-owned support data. It never
 * exposes raw ticket contents, push tokens, or Auth0 metadata.
 */
export const lookupFerryUserSupportProfile = async (lookup: {
  email?: unknown;
  subject?: unknown;
}): Promise<AdminSupportProfile | null> => {
  const hasEmail =
    typeof lookup.email === "string" && lookup.email.trim() !== "";
  const hasSubject =
    typeof lookup.subject === "string" && lookup.subject.trim() !== "";
  if (hasEmail === hasSubject) {
    throw new Error("Provide exactly one email or subject");
  }
  const identity = hasEmail
    ? await findAuth0UserByExactEmail(lookup.email as string)
    : {
        email: await getAuth0UserEmail(lookup.subject as string),
        subject: lookup.subject as string,
      };
  if (!identity) {
    return null;
  }
  // Keep the deletion/sign-out service importable without constructing these
  // Sequelize models. The support lookup is the only consumer of them.
  const [
    { LeaderboardCheckin },
    { LeaderboardProfile },
    { LeaderboardTerminalPresence },
  ] = await Promise.all([
    import("~/models/LeaderboardCheckin"),
    import("~/models/LeaderboardProfile"),
    import("~/models/LeaderboardTerminalPresence"),
  ]);
  const [settings, profile, total, terminal, vessel, terminalPresenceCount] =
    await Promise.all([
      UserSettings.findByPk(identity.subject),
      LeaderboardProfile.findByPk(identity.subject),
      LeaderboardCheckin.count({ where: { subject: identity.subject } }),
      LeaderboardCheckin.count({
        where: { kind: "terminal", subject: identity.subject },
      }),
      LeaderboardCheckin.count({
        where: { kind: "vessel", subject: identity.subject },
      }),
      LeaderboardTerminalPresence.count({
        where: { subject: identity.subject },
      }),
    ]);
  const appMetadata = settings?.appMetadata ?? {};
  return {
    email: identity.email,
    leaderboard: {
      checkins: { terminal, total, vessel },
      optedOut: profile?.optedOut ?? null,
      profile: profile
        ? {
            automaticCheckinsEnabled: profile.automaticCheckinsEnabled,
            displayName: profile.displayName,
            notificationsEnabled: profile.notificationsEnabled,
            optedOut: profile.optedOut,
            useFullName: profile.useFullName,
            verboseNotificationsEnabled: profile.verboseNotificationsEnabled,
          }
        : null,
      profileExists: Boolean(profile),
      terminalPresenceCount,
    },
    settings: settings
      ? {
          alertRules: appMetadata.alertRules ?? [],
          alertSubscriptions: appMetadata.alertSubscriptions ?? {},
          favoriteRouteIds: settings.favoriteRouteIds ?? [],
          hasPushToken: Boolean(appMetadata.fcmToken),
          subscribedTerminalIds: appMetadata.subscribedTerminals ?? [],
          ticketCount: appMetadata.tickets?.length ?? 0,
        }
      : null,
    subject: identity.subject,
  };
};
