import type { Transaction } from "sequelize";
import type { AccountDeletionResult } from "shared/contracts/user";

import { revokeApplicationTokens } from "~/lib/admin/sessionRevocation";
import { deleteAuth0User } from "~/lib/auth0Admin";
import { db } from "~/lib/db";
import { lockLeaderboardAutomaticPolicy } from "~/lib/leaderboardAutomaticPolicy";
import { anonymizeLeaderboardAccount } from "~/lib/leaderboardPrivacy";
import { FeatureFlagAllowlist } from "~/models/FeatureFlagAllowlist";
import { UserSettings } from "~/models/UserSettings";
import { UserTicket } from "~/models/UserTicket";

export interface DeletedUserDataResult {
  /** retains the Auth0 identity */
  auth0Identity: "retained";
  /** repeat-safe completion */
  status: "complete";
}

// shared identifying-data deletion
const deleteFerryUserDataInTransaction = async (
  subject: string,
  transaction: Transaction
): Promise<void> => {
  const policy = await lockLeaderboardAutomaticPolicy(transaction, {
    lockCheckins: true,
    lockPresence: true,
    lockReceipts: true,
    subject,
  });
  // commit revocation with deletion
  await revokeApplicationTokens(subject, new Date(), transaction);
  await anonymizeLeaderboardAccount(subject, transaction, policy);

  await Promise.all([
    UserSettings.destroy({ transaction, where: { subject } }),
    UserTicket.destroy({ transaction, where: { subject } }),
    // remove feature allowlist link
    FeatureFlagAllowlist.destroy({ transaction, where: { subject } }),
  ]);
};

/** removes app-owned identity state while retaining Auth0 */
export const deleteFerryUserData = async (
  subject: string
): Promise<DeletedUserDataResult> => {
  // run app deletion atomically
  await db.transaction((transaction) =>
    deleteFerryUserDataInTransaction(subject, transaction)
  );

  return { auth0Identity: "retained", status: "complete" };
};

/** permanently removes a Ferry FYI account */
export const deleteFerryUserAccount = async (
  subject: string
): Promise<AccountDeletionResult> => {
  // bind app and identity deletion
  await db.transaction(async (transaction) => {
    await deleteFerryUserDataInTransaction(subject, transaction);
    // preserve retry on Auth0 failure
    await deleteAuth0User(subject);
  });

  return { status: "complete" };
};
