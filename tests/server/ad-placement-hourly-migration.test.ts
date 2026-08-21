import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Sequelize = require("sequelize");
const migration = require("../../server/migrations/20260820000100-create-ad-placement-hourly-metrics.js");

// create isolated hourly migration doubles
const migrationHarness = () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    addColumn: vi.fn().mockResolvedValue(undefined),
    addConstraint: vi.fn().mockResolvedValue(undefined),
    createTable: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue([[], 0]),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

// cover pacific-hour inventory schema
describe("ad placement hourly migration", () => {
  // preserve in-flight exposure hours
  it("backfills pacific hours before enforcing the column", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "AdMeasurementExposures",
      "businessHour",
      expect.objectContaining({
        allowNull: false,
        defaultValue: expect.objectContaining({ val: expect.any(String) }),
        type: Sequelize.SMALLINT,
      }),
      { transaction }
    );
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining("AT TIME ZONE 'America/Los_Angeles'"),
      { transaction }
    );
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "AdPlacementHourlyMetrics",
      expect.objectContaining({
        businessDate: expect.objectContaining({ primaryKey: true }),
        businessHour: expect.objectContaining({ primaryKey: true }),
        placementKey: expect.objectContaining({ primaryKey: true }),
      }),
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // remove the added storage only
  it("drops hourly storage and attribution on rollback", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await migration.down(queryInterface);

    expect(queryInterface.dropTable).toHaveBeenCalledWith(
      "AdPlacementHourlyMetrics",
      { transaction }
    );
    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "AdMeasurementExposures",
      "businessHour",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // rollback failed schema upgrades
  it("rolls back when the exposure backfill fails", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.sequelize.query.mockRejectedValueOnce(
      new Error("backfill failed")
    );

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "backfill failed"
    );

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
