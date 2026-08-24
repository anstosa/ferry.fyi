import { Op } from "sequelize";
import type {
  Leaderboard,
  LeaderboardPeriod,
  LeaderboardRank,
} from "shared/contracts/leaderboards";

import { db } from "~/lib/db";
import { leaderboardsEnabled } from "~/lib/leaderboardFlags";
import { getActiveSupporterSubjects } from "~/lib/supporter";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";

import {
  leaderboardLabel,
  limitLeaderboardRanks,
  periodStart,
} from "../../lib/leaderboards";

type LeaderboardCheckinRow = { score: number | string; subject: string };

export const parsePublicLeaderboardPeriod = (
  value: unknown
): LeaderboardPeriod | null =>
  value === "all" || value === "month" || value === "week" ? value : null;

/** Public evaluation never incorporates a subject allowlist. */
export const publicLeaderboardsEnabled = (): Promise<boolean> =>
  leaderboardsEnabled();

/**
 * Returns the public, privacy-filtered ranking shared by API adapters and
 * future anonymous document loaders. This never accepts a subject or a
 * private feature decision.
 */
export const getPublicLeaderboard = async ({
  entityId,
  kind,
  period,
}: {
  entityId: string;
  kind: "terminal" | "vessel";
  period: LeaderboardPeriod;
}): Promise<Leaderboard> => {
  const start = periodStart(period);
  const rows = (await LeaderboardCheckin.findAll({
    attributes: ["subject", [db.fn("COUNT", db.col("id")), "score"]],
    group: ["subject"],
    order: [
      [db.literal('"score"'), "DESC"],
      ["subject", "ASC"],
    ],
    raw: true,
    where: {
      entityId,
      kind,
      ...(start ? { occurredAt: { [Op.gte]: start } } : {}),
    },
  })) as unknown as LeaderboardCheckinRow[];
  const subjects = rows.map((row) => row.subject);
  const profiles = subjects.length
    ? await LeaderboardProfile.findAll({
        where: { subject: { [Op.in]: subjects } },
      })
    : [];
  const profileBySubject = new Map(
    profiles.map((profile) => [profile.subject, profile])
  );
  const supporterSubjects = await getActiveSupporterSubjects(
    profiles
      // include default-on or explicitly enabled badge preferences
      .filter(
        (profile) =>
          !profile.optedOut &&
          (!profile.supporterBadgePreferenceSet ||
            profile.supporterBadgeVisible)
      )
      .map((profile) => profile.subject)
  );
  const ranks = rows
    .map((row): Omit<LeaderboardRank, "rank"> | null => {
      const profile = profileBySubject.get(row.subject);
      if (profile?.optedOut) {
        return null;
      }
      return {
        label: profile ? leaderboardLabel(profile.displayName) : "Anonymous",
        score: Number(row.score),
        supporterBadge: supporterSubjects.has(row.subject),
      };
    })
    .filter((rank): rank is Omit<LeaderboardRank, "rank"> => rank !== null);

  return {
    entityId,
    period,
    ranks: limitLeaderboardRanks(ranks).map((rank, index) => ({
      ...rank,
      rank: index + 1,
    })),
  };
};
