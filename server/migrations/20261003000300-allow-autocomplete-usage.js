"use strict";

// replace the sku constraint atomically without changing stored aggregates
const setSkuConstraint = async (queryInterface, skus) => {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeConstraint(
      "GoogleRoutesUsageMonths",
      "google_routes_usage_sku_valid",
      { transaction }
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "GoogleRoutesUsageMonths" ADD CONSTRAINT "google_routes_usage_sku_valid" CHECK ("sku" IN (${skus.map(() => "?").join(", ")}))`,
      { replacements: skus, transaction }
    );
  });
};

module.exports = {
  // permit the separately billed places autocomplete sku
  up: async (queryInterface) => {
    await setSkuConstraint(queryInterface, [
      "compute_routes_essentials",
      "compute_routes_pro",
      "autocomplete_requests",
    ]);
  },
  // refuse rollback with retained autocomplete rows rather than deleting evidence
  down: async (queryInterface) => {
    await setSkuConstraint(queryInterface, [
      "compute_routes_essentials",
      "compute_routes_pro",
    ]);
  },
};
