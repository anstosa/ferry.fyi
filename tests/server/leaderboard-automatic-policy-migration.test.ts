import { createRequire } from "node:module";

import { DataTypes } from "sequelize";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260817000600-add-server-policy-generation-to-feature-flags.js");

// cover generation schema changes
describe("automatic policy generation migration", () => {
  // prove durable zero backfill
  it("adds a non-null bigint with a restart-stable default", async () => {
    const queryInterface = { addColumn: vi.fn().mockResolvedValue(undefined) };

    await migration.up(queryInterface, DataTypes);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "FeatureFlags",
      "serverPolicyGeneration",
      expect.objectContaining({
        allowNull: false,
        defaultValue: 0,
        type: DataTypes.BIGINT,
      })
    );
  });

  // prove reversible schema policy
  it("removes only the generation column on rollback", async () => {
    const queryInterface = {
      removeColumn: vi.fn().mockResolvedValue(undefined),
    };

    await migration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "FeatureFlags",
      "serverPolicyGeneration"
    );
  });
});
