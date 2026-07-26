import type { Transaction } from "sequelize";

import { anonymizedLeaderboardSubject } from "~/lib/leaderboards";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";

// Call from the account-deletion workflow. Scores remain, but the account link is irreversibly removed.
export const anonymizeLeaderboardAccount = async (
  subject: string,
  transaction?: Transaction
): Promise<string> => {
  // Generate this once per deletion.  A replacement subject must never be
  // derivable from the deleted account, and every retained check-in must use
  // the same replacement identity so its score history remains aggregateable.
  const anonymizedSubject = anonymizedLeaderboardSubject();

  // Retain score/check-in history only after its account link is gone.  Do
  // this before deleting the profile and presence state in the same caller's
  // transaction, so a rollback leaves the account entirely intact.
  await LeaderboardCheckin.update(
    { subject: anonymizedSubject },
    { transaction, where: { subject } }
  );
  await Promise.all([
    LeaderboardProfile.destroy({ transaction, where: { subject } }),
    LeaderboardTerminalPresence.destroy({ transaction, where: { subject } }),
  ]);

  return anonymizedSubject;
};
