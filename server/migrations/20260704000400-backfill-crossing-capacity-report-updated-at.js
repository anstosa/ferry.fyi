"use strict";

module.exports = {
  up: async (queryInterface) => {
    // backfill freshness from update time
    await queryInterface.sequelize.query(`
      UPDATE "Crossings"
      SET "capacityReportUpdatedAt" = FLOOR(EXTRACT(EPOCH FROM "updatedAt"))
      WHERE "capacityReportUpdatedAt" IS NULL
        AND "updatedAt" IS NOT NULL
    `);
  },

  down: async () => {
    // data-only migration
  },
};
