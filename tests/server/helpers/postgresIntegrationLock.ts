import { Sequelize, type Transaction } from "sequelize";

/** serializes process-global Postgres integration harness state */
export const acquirePostgresIntegrationLock = async (
  database: Sequelize
): Promise<Transaction> => {
  const transaction = await database.transaction();

  // acquire one session lock
  try {
    await database.query("SELECT pg_advisory_xact_lock(1787006795, 4)", {
      transaction,
    });
    return transaction;
  } catch (error) {
    // release failed acquisition
    await transaction.rollback();
    throw error;
  }
};
