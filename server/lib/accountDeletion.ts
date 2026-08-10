import type { Transaction } from "sequelize";
import type { AccountDeletionResult } from "shared/contracts/user";

import { revokeApplicationTokens } from "~/lib/admin/sessionRevocation";
import { deleteAuth0User } from "~/lib/auth0Admin";
import { db } from "~/lib/db";
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
  // commit revocation with deletion
  await revokeApplicationTokens(subject, new Date(), transaction);
  await anonymizeLeaderboardAccount(subject, transaction);

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
  await db.transaction((transaction) =>
    deleteFerryUserDataInTransaction(subject, transaction)
  );

  return { auth0Identity: "retained", status: "complete" };
};

/** permanently removes a Ferry FYI account */
export const deleteFerryUserAccount = async (
  subject: string
): Promise<AccountDeletionResult> => {
  await db.transaction(async (transaction) => {
    await deleteFerryUserDataInTransaction(subject, transaction);
    // preserve retry on Auth0 failure
    await deleteAuth0User(subject);
  });

  return { status: "complete" };
};
