import type { Transaction } from "sequelize";

import { anonymizedLeaderboardSubject } from "~/lib/leaderboards";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";

// Call from the account-deletion workflow. Scores remain, but the account link is irreversibly removed.
export const anonymizeLeaderboardAccount = async (
  subject: string,
  transaction?: Transaction
): Promise<void> => {
  await Promise.all([
    LeaderboardCheckin.update(
      { subject: anonymizedLeaderboardSubject() },
      { transaction, where: { subject } }
    ),
    LeaderboardProfile.destroy({ transaction, where: { subject } }),
    LeaderboardTerminalPresence.destroy({ transaction, where: { subject } }),
  ]);
};
