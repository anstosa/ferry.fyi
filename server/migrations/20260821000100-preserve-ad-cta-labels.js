"use strict";

// define one backward-compatible snapshot field
const ctaColumn = (Sequelize) => ({
  allowNull: false,
  defaultValue: "",
  type: Sequelize.STRING,
});

module.exports = {
  // converge campaign snapshots with deployed ad schemas
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const placementColumns = await queryInterface.describeTable(
        "AdPlacements",
        { transaction }
      );
      // add the placement snapshot source when absent
      if (!("ctaLabel" in placementColumns)) {
        await queryInterface.addColumn(
          "AdPlacements",
          "ctaLabel",
          ctaColumn(Sequelize),
          { transaction }
        );
      }
      const campaignColumns = await queryInterface.describeTable(
        "AdCampaigns",
        { transaction }
      );
      // add the immutable campaign field when absent
      if (!("ctaLabel" in campaignColumns)) {
        await queryInterface.addColumn(
          "AdCampaigns",
          "ctaLabel",
          ctaColumn(Sequelize),
          { transaction }
        );
      }
      // keep older servers able to create empty-label snapshots
      await queryInterface.changeColumn(
        "AdPlacements",
        "ctaLabel",
        ctaColumn(Sequelize),
        { transaction }
      );
      await queryInterface.changeColumn(
        "AdCampaigns",
        "ctaLabel",
        ctaColumn(Sequelize),
        { transaction }
      );
      await queryInterface.sequelize.query(
        `CREATE OR REPLACE FUNCTION protect_ad_campaign_immutability() RETURNS trigger AS $$
        BEGIN
          IF NEW."placementKey" IS DISTINCT FROM OLD."placementKey"
            OR NEW."slot" IS DISTINCT FROM OLD."slot"
            OR NEW."departureTerminalId" IS DISTINCT FROM OLD."departureTerminalId"
            OR NEW."arrivalTerminalId" IS DISTINCT FROM OLD."arrivalTerminalId"
            OR NEW."reportName" IS DISTINCT FROM OLD."reportName"
            OR NEW."advertiserName" IS DISTINCT FROM OLD."advertiserName"
            OR NEW."headline" IS DISTINCT FROM OLD."headline"
            OR NEW."body" IS DISTINCT FROM OLD."body"
            OR NEW."ctaLabel" IS DISTINCT FROM OLD."ctaLabel"
            OR NEW."targetUrl" IS DISTINCT FROM OLD."targetUrl"
            OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
            OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
            OR (OLD."endedEarlyAt" IS NOT NULL AND NEW."endedEarlyAt" IS DISTINCT FROM OLD."endedEarlyAt")
          THEN
            RAISE EXCEPTION 'Ad campaign reporting fields are immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // rollback the whole schema convergence
      await transaction.rollback();
      throw error;
    }
  },

  // remove the optional call-to-action snapshot
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `CREATE OR REPLACE FUNCTION protect_ad_campaign_immutability() RETURNS trigger AS $$
        BEGIN
          IF NEW."placementKey" IS DISTINCT FROM OLD."placementKey"
            OR NEW."slot" IS DISTINCT FROM OLD."slot"
            OR NEW."departureTerminalId" IS DISTINCT FROM OLD."departureTerminalId"
            OR NEW."arrivalTerminalId" IS DISTINCT FROM OLD."arrivalTerminalId"
            OR NEW."reportName" IS DISTINCT FROM OLD."reportName"
            OR NEW."advertiserName" IS DISTINCT FROM OLD."advertiserName"
            OR NEW."headline" IS DISTINCT FROM OLD."headline"
            OR NEW."body" IS DISTINCT FROM OLD."body"
            OR NEW."targetUrl" IS DISTINCT FROM OLD."targetUrl"
            OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
            OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
            OR (OLD."endedEarlyAt" IS NOT NULL AND NEW."endedEarlyAt" IS DISTINCT FROM OLD."endedEarlyAt")
          THEN
            RAISE EXCEPTION 'Ad campaign reporting fields are immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,
        { transaction }
      );
      await queryInterface.removeColumn("AdCampaigns", "ctaLabel", {
        transaction,
      });
      await queryInterface.removeColumn("AdPlacements", "ctaLabel", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      // rollback the whole schema change
      await transaction.rollback();
      throw error;
    }
  },
};
