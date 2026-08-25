import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260825000100-add-supporter-ads-enabled.js");
const Sequelize = { BOOLEAN: "BOOLEAN" };

describe("supporter ads preference migration", () => {
  // default every supporter to ad-free
  it("adds the supporter preference with an ad-free default", async () => {
    const queryInterface = {
      addColumn: vi.fn().mockResolvedValue(undefined),
      removeColumn: vi.fn().mockResolvedValue(undefined),
    };

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "SupporterCustomers",
      "adsEnabled",
      { allowNull: false, defaultValue: false, type: "BOOLEAN" }
    );
  });

  // remove only the added preference
  it("removes the supporter preference on rollback", async () => {
    const queryInterface = {
      addColumn: vi.fn().mockResolvedValue(undefined),
      removeColumn: vi.fn().mockResolvedValue(undefined),
    };

    await migration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "SupporterCustomers",
      "adsEnabled"
    );
  });
});
