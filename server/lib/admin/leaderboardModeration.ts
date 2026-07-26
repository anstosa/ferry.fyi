import { Op, Transaction } from "sequelize";

import { db } from "~/lib/db";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";

export type LeaderboardEntityKind = "terminal" | "vessel";

const checkinAttributes = ["id", "entityId", "kind", "occurredAt", "sailingId"];

const toCheckin = (row: LeaderboardCheckin) => ({
  entityId: row.entityId,
  id: String(row.get("id")),
  kind: row.kind,
  occurredAt: row.occurredAt.toISOString(),
  sailingId: row.sailingId,
});

/** Exact-subject support data only; no free-text or broad participant search. */
export const getLeaderboardSubjectState = async (
  subject: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
) => {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const safeOffset = Math.max(Math.floor(offset), 0);
  const [profile, totalCheckins, checkins, terminalPresences] =
    await Promise.all([
      LeaderboardProfile.findByPk(subject),
      LeaderboardCheckin.count({ where: { subject } }),
      LeaderboardCheckin.findAll({
        attributes: checkinAttributes,
        limit: safeLimit,
        offset: safeOffset,
        order: [
          ["occurredAt", "DESC"],
          ["id", "DESC"],
        ],
        where: { subject },
      }),
      LeaderboardTerminalPresence.findAll({
        attributes: ["terminalId", "lastCreditedAt", "exitedAt"],
        order: [["terminalId", "ASC"]],
        where: { subject },
      }),
    ]);
  return {
    checkins: checkins.map(toCheckin),
    checkinsTotal: totalCheckins,
    profile: profile
      ? {
          displayName: profile.displayName,
          notificationsEnabled: profile.notificationsEnabled,
          optedOut: profile.optedOut,
          useFullName: profile.useFullName,
          verboseNotificationsEnabled: profile.verboseNotificationsEnabled,
        }
      : null,
    terminalPresence: terminalPresences.map((presence) => ({
      exitedAt: presence.exitedAt?.toISOString() ?? null,
      lastCreditedAt: presence.lastCreditedAt?.toISOString() ?? null,
      terminalId: presence.terminalId,
    })),
  };
};

const ensureProfile = async (subject: string, transaction: Transaction) => {
  const [profile] = await LeaderboardProfile.findOrCreate({
    defaults: { subject },
    transaction,
    where: { subject },
  });
  return profile;
};

/** Hiding is opt-out: retained check-ins are immediately excluded publicly. */
export const setLeaderboardProfileHidden = async (
  subject: string,
  hidden: boolean
): Promise<{ hidden: boolean; subject: string }> =>
  db.transaction(async (transaction) => {
    const profile = await ensureProfile(subject, transaction);
    await profile.update({ optedOut: hidden }, { transaction });
    return { hidden: profile.optedOut, subject };
  });

/** Reset deletes a subject's derived score inputs and live eligibility state. */
export const resetLeaderboardProfile = async (
  subject: string
): Promise<{ deletedCheckins: number; subject: string }> =>
  db.transaction(async (transaction) => {
    const deletedCheckins = await LeaderboardCheckin.destroy({
      transaction,
      where: { subject },
    });
    await LeaderboardTerminalPresence.destroy({
      transaction,
      where: { subject },
    });
    return { deletedCheckins, subject };
  });

/** Deletion is deliberately repeat-safe, including an already removed check-in. */
export const deleteLeaderboardCheckin = async (
  id: string
): Promise<{ deleted: boolean; id: string }> =>
  db.transaction(async (transaction) => {
    const deleted = await LeaderboardCheckin.destroy({
      transaction,
      where: { id },
    });
    return { deleted: deleted > 0, id };
  });

export const getLeaderboardMetrics = async () => {
  const [terminalCheckins, vesselCheckins, participants, optedOutProfiles] =
    await Promise.all([
      LeaderboardCheckin.count({ where: { kind: "terminal" } }),
      LeaderboardCheckin.count({ where: { kind: "vessel" } }),
      LeaderboardCheckin.count({ distinct: true, col: "subject" }),
      LeaderboardProfile.count({ where: { optedOut: true } }),
    ]);
  return { optedOutProfiles, participants, terminalCheckins, vesselCheckins };
};

/**
 * Scores are derived directly from retained check-ins, so rebuild verifies the
 * canonical aggregate rather than duplicating it in a mutable score table.
 */
export const rebuildLeaderboardAggregates = async (): Promise<void> => {
  await LeaderboardCheckin.count({ where: { subject: { [Op.ne]: "" } } });
};
