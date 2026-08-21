import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Sequelize = require("sequelize");
const migration = require("../../server/migrations/20260821000100-preserve-ad-cta-labels.js");

// create isolated schema convergence doubles
const migrationHarness = (hasColumns: boolean) => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    addColumn: vi.fn().mockResolvedValue(undefined),
    changeColumn: vi.fn().mockResolvedValue(undefined),
    describeTable: vi
      .fn()
      .mockResolvedValue(hasColumns ? { ctaLabel: {} } : {}),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue([[], 0]),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

describe("ad call-to-action migration", () => {
  // add both missing snapshot fields
  it("adds required call-to-action columns and protects campaign immutability", async () => {
    const { queryInterface, transaction } = migrationHarness(false);

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.addColumn).toHaveBeenCalledTimes(2);
    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "AdCampaigns",
      "ctaLabel",
      expect.objectContaining({ allowNull: false, defaultValue: "" }),
      { transaction }
    );
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('NEW."ctaLabel" IS DISTINCT FROM OLD."ctaLabel"'),
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // preserve already-deployed columns
  it("converges existing columns without trying to add them again", async () => {
    const { queryInterface, transaction } = migrationHarness(true);

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.addColumn).not.toHaveBeenCalled();
    expect(queryInterface.changeColumn).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // restore the pre-feature immutability boundary
  it("removes both snapshot columns on rollback", async () => {
    const { queryInterface, transaction } = migrationHarness(true);

    await migration.down(queryInterface);

    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.not.stringContaining('NEW."ctaLabel"'),
      { transaction }
    );
    expect(queryInterface.removeColumn).toHaveBeenNthCalledWith(
      1,
      "AdCampaigns",
      "ctaLabel",
      { transaction }
    );
    expect(queryInterface.removeColumn).toHaveBeenNthCalledWith(
      2,
      "AdPlacements",
      "ctaLabel",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // rollback partial schema convergence
  it("rolls back when column convergence fails", async () => {
    const { queryInterface, transaction } = migrationHarness(true);
    queryInterface.changeColumn.mockRejectedValueOnce(
      new Error("column change failed")
    );

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "column change failed"
    );

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
