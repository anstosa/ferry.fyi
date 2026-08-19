import { Op, type Transaction } from "sequelize";

import {
  advanceServerPolicyGeneration,
  type LockedLeaderboardAutomaticPolicy,
  lockLeaderboardAutomaticPolicy,
  withLeaderboardAutomaticPolicyTransaction,
} from "~/lib/leaderboardAutomaticPolicy";
import { anonymizedLeaderboardSubject } from "~/lib/leaderboards";
import { LeaderboardAutomaticCandidateReceipt } from "~/models/LeaderboardAutomaticCandidateReceipt";
import { LeaderboardAutomaticEnrollment } from "~/models/LeaderboardAutomaticEnrollment";
import { LeaderboardCheckin } from "~/models/LeaderboardCheckin";
import { LeaderboardProfile } from "~/models/LeaderboardProfile";
import { LeaderboardTerminalPresence } from "~/models/LeaderboardTerminalPresence";

// delete native identity before retaining scores
const anonymizeWithLockedPolicy = async (
  subject: string,
  policy: LockedLeaderboardAutomaticPolicy
): Promise<string> => {
  const anonymizedSubject = anonymizedLeaderboardSubject();
  // project locked enrollment identities
  const enrollmentIds = policy.enrollments.map(
    ({ enrollmentId }) => enrollmentId
  );

  // remove payload-bound receipts first
  if (enrollmentIds.length > 0) {
    await LeaderboardAutomaticCandidateReceipt.destroy({
      transaction: policy.transaction,
      where: { enrollmentId: { [Op.in]: enrollmentIds } },
    });
  }

  await LeaderboardAutomaticEnrollment.destroy({
    transaction: policy.transaction,
    where: { subject },
  });
  await LeaderboardCheckin.update(
    { subject: anonymizedSubject },
    { transaction: policy.transaction, where: { subject } }
  );
  await LeaderboardTerminalPresence.destroy({
    transaction: policy.transaction,
    where: { subject },
  });
  await LeaderboardProfile.destroy({
    transaction: policy.transaction,
    where: { subject },
  });
  await advanceServerPolicyGeneration(policy);
  return anonymizedSubject;
};

/** irreversibly removes account links while retaining anonymized scores */
export const anonymizeLeaderboardAccount = async (
  subject: string,
  transaction?: Transaction,
  lockedPolicy?: LockedLeaderboardAutomaticPolicy
): Promise<string> => {
  // reuse the caller's complete policy lock
  if (lockedPolicy) {
    return await anonymizeWithLockedPolicy(subject, lockedPolicy);
  }

  // complete the exact lock order in a caller transaction
  if (transaction) {
    const policy = await lockLeaderboardAutomaticPolicy(transaction, {
      lockCheckins: true,
      lockPresence: true,
      lockReceipts: true,
      subject,
    });
    return await anonymizeWithLockedPolicy(subject, policy);
  }

  return await withLeaderboardAutomaticPolicyTransaction(
    {
      lockCheckins: true,
      lockPresence: true,
      lockReceipts: true,
      subject,
    },
    // reuse the locked deletion boundary
    async (policy) => await anonymizeWithLockedPolicy(subject, policy)
  );
};
