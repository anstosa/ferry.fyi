import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260824000200-default-supporter-badge-visible.js");
const Sequelize = { BOOLEAN: "BOOLEAN" };

// create one isolated badge migration harness
const migrationHarness = () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    addColumn: vi.fn().mockResolvedValue(undefined),
    changeColumn: vi.fn().mockResolvedValue(undefined),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

describe("supporter badge default migration", () => {
  // default unconfigured badges on
  it("adds explicit-choice tracking and enables active supporters", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "LeaderboardProfiles",
      "supporterBadgePreferenceSet",
      { allowNull: false, defaultValue: false, type: "BOOLEAN" },
      { transaction }
    );
    expect(queryInterface.changeColumn).toHaveBeenCalledWith(
      "LeaderboardProfiles",
      "supporterBadgeVisible",
      { allowNull: false, defaultValue: true, type: "BOOLEAN" },
      { transaction }
    );
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "SupporterCustomers"'),
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  // preserve data while restoring the old schema
  it("restores the legacy column default on rollback", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.down(queryInterface, Sequelize);

    expect(queryInterface.changeColumn).toHaveBeenCalledWith(
      "LeaderboardProfiles",
      "supporterBadgeVisible",
      { allowNull: false, defaultValue: false, type: "BOOLEAN" },
      { transaction }
    );
    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "LeaderboardProfiles",
      "supporterBadgePreferenceSet",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // roll back failed badge writes
  it("rolls back when active supporter updates fail", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.sequelize.query.mockRejectedValueOnce(
      new Error("write failed")
    );

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "write failed"
    );

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
