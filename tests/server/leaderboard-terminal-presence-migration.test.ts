import { createRequire } from "node:module";

import { DataTypes } from "sequelize";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260817000400-add-last-observed-at-to-leaderboard-terminal-presences.js");

// create isolated chronology migration doubles
const migrationHarness = () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    addColumn: vi.fn().mockResolvedValue(undefined),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue([[], 0]),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

// cover populated chronology upgrades
describe("terminal presence chronology migration", () => {
  // prove nullable chronology and exact non-fabricating backfill
  it("adds lastObservedAt with SQL GREATEST in one transaction", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.up(queryInterface, DataTypes);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "LeaderboardTerminalPresences",
      "lastObservedAt",
      expect.objectContaining({ allowNull: true }),
      { transaction }
    );
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SET "lastObservedAt" = GREATEST\("lastCreditedAt", "exitedAt"\)/
      ),
      { transaction }
    );
    const backfillSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(backfillSql).not.toMatch(/CURRENT_TIMESTAMP|NOW\(\)|new Date/i);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  // prove reversible repository migration policy
  it("removes lastObservedAt transactionally on down", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "LeaderboardTerminalPresences",
      "lastObservedAt",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove failures roll back the schema and data change
  it("rolls back a failed chronology backfill", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.sequelize.query.mockRejectedValueOnce(
      new Error("backfill failed")
    );

    await expect(migration.up(queryInterface, DataTypes)).rejects.toThrow(
      "backfill failed"
    );

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
