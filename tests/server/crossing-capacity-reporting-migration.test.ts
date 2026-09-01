import { DataTypes } from "sequelize";
import { describe, expect, it, vi } from "vitest";

const migrationModule =
  await import("../../server/migrations/20260831000100-add-crossing-capacity-reporting-started-at.js");
const migration = migrationModule.default;

describe("crossing capacity reporting migration", () => {
  // prove the additive nullable column
  it("adds only the unindexed reporting-start timestamp", async () => {
    const queryInterface = {
      addColumn: vi.fn().mockResolvedValue(undefined),
      addIndex: vi.fn().mockResolvedValue(undefined),
      sequelize: { query: vi.fn().mockResolvedValue(undefined) },
    };

    await migration.up(queryInterface, DataTypes);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "Crossings",
      "capacityReportingStartedAt",
      expect.objectContaining({
        allowNull: true,
        type: DataTypes.INTEGER,
      })
    );
    expect(queryInterface.addIndex).not.toHaveBeenCalled();
    expect(queryInterface.sequelize.query).not.toHaveBeenCalled();
  });

  // prove the bounded rollback
  it("removes only the reporting-start timestamp", async () => {
    const queryInterface = {
      removeColumn: vi.fn().mockResolvedValue(undefined),
    };

    await migration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "Crossings",
      "capacityReportingStartedAt"
    );
  });
});
