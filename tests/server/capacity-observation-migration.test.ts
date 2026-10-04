import { beforeEach, describe, expect, it, vi } from "vitest";

import migration from "../../server/migrations/20261003000100-create-capacity-observations.js";

describe("capacity observation migration", () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };

  // create migration doubles
  const createQueryInterface = () => ({
    addIndex: vi.fn(),
    createTable: vi.fn(),
    dropTable: vi.fn(),
    sequelize: {
      query: vi.fn(),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  });

  const Sequelize = {
    BIGINT: "BIGINT",
    BOOLEAN: "BOOLEAN",
    DOUBLE: "DOUBLE",
    INTEGER: "INTEGER",
    STRING: vi.fn((length) => `STRING(${length})`),
    UUID: "UUID",
  };

  // reset transaction evidence
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // prove identity, provenance, and retention indexes
  it("creates the immutable observation schema", async () => {
    const queryInterface = createQueryInterface();

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "CapacityObservations",
      expect.objectContaining({
        allocationGroupId: expect.objectContaining({ allowNull: true }),
        pollId: expect.objectContaining({ allowNull: false }),
        receivedAt: expect.objectContaining({ allowNull: false }),
        triggerPollId: expect.objectContaining({ allowNull: true }),
      }),
      { transaction }
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "CapacityObservations",
      ["pollId", "allocationGroupId", "arrivalId", "departureTime"],
      expect.objectContaining({ unique: true })
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "CapacityObservations",
      [
        "triggerPollId",
        "departureId",
        "arrivalId",
        "departureTime",
        "repairReason",
      ],
      expect.objectContaining({ unique: true })
    );
    const constraintSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(constraintSql).toContain("capacity_observations_source_integrity");
    expect(constraintSql).toContain("reject_capacity_observation_update");
    expect(constraintSql).toContain('"allocationGroupId" IS NOT NULL');
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // roll back a partial schema creation
  it("rolls back failed schema work", async () => {
    const queryInterface = createQueryInterface();
    queryInterface.sequelize.query.mockRejectedValue(new Error("sql failed"));

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "sql failed"
    );

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  // remove the update guard before the table
  it("drops only migration-owned objects", async () => {
    const queryInterface = createQueryInterface();

    await migration.down(queryInterface);

    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "DROP TRIGGER IF EXISTS reject_capacity_observation_update_trigger"
      ),
      { transaction }
    );
    expect(queryInterface.dropTable).toHaveBeenCalledWith(
      "CapacityObservations",
      { transaction }
    );
  });
});
