"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable(
        "AdCampaigns",
        {
          id: { allowNull: false, primaryKey: true, type: Sequelize.UUID },
          placementKey: {
            allowNull: false,
            onDelete: "RESTRICT",
            onUpdate: "RESTRICT",
            references: { key: "key", model: "AdPlacements" },
            type: Sequelize.STRING,
          },
          slot: { allowNull: false, type: Sequelize.STRING },
          departureTerminalId: { allowNull: true, type: Sequelize.STRING },
          arrivalTerminalId: { allowNull: true, type: Sequelize.STRING },
          reportName: { allowNull: false, type: Sequelize.STRING },
          advertiserName: { allowNull: false, type: Sequelize.STRING },
          headline: { allowNull: false, type: Sequelize.STRING },
          body: { allowNull: false, type: Sequelize.TEXT },
          targetUrl: { allowNull: false, type: Sequelize.TEXT },
          startsAt: { allowNull: false, type: Sequelize.DATE },
          endsAt: { allowNull: false, type: Sequelize.DATE },
          endedEarlyAt: { allowNull: true, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addConstraint("AdCampaigns", {
        fields: ["startsAt", "endsAt"],
        name: "ad_campaign_valid_schedule",
        transaction,
        type: "check",
        where: { startsAt: { [Sequelize.Op.lt]: Sequelize.col("endsAt") } },
      });
      await queryInterface.addConstraint("AdCampaigns", {
        fields: ["endedEarlyAt", "endsAt"],
        name: "ad_campaign_valid_early_end",
        transaction,
        type: "check",
        where: {
          [Sequelize.Op.or]: [
            { endedEarlyAt: null },
            { endedEarlyAt: { [Sequelize.Op.lte]: Sequelize.col("endsAt") } },
          ],
        },
      });
      await queryInterface.addIndex(
        "AdCampaigns",
        ["placementKey", "startsAt", "endsAt"],
        { transaction }
      );

      await queryInterface.createTable(
        "AdPlacementDailyMetrics",
        {
          businessDate: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.DATEONLY,
          },
          placementKey: {
            allowNull: false,
            onDelete: "RESTRICT",
            onUpdate: "RESTRICT",
            primaryKey: true,
            references: { key: "key", model: "AdPlacements" },
            type: Sequelize.STRING,
          },
          opportunityCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
        },
        { transaction }
      );
      await queryInterface.addConstraint("AdPlacementDailyMetrics", {
        fields: ["opportunityCount"],
        name: "ad_placement_metrics_nonnegative",
        transaction,
        type: "check",
        where: { opportunityCount: { [Sequelize.Op.gte]: 0 } },
      });

      await queryInterface.createTable(
        "AdCampaignDailyMetrics",
        {
          businessDate: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.DATEONLY,
          },
          campaignId: {
            allowNull: false,
            onDelete: "RESTRICT",
            onUpdate: "RESTRICT",
            primaryKey: true,
            references: { key: "id", model: "AdCampaigns" },
            type: Sequelize.UUID,
          },
          opportunityCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
          servedCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
          viewableCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
          clickCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
        },
        { transaction }
      );
      for (const field of [
        "opportunityCount",
        "servedCount",
        "viewableCount",
        "clickCount",
      ]) {
        await queryInterface.addConstraint("AdCampaignDailyMetrics", {
          fields: [field],
          name: `ad_campaign_metrics_${field}_nonnegative`,
          transaction,
          type: "check",
          where: { [field]: { [Sequelize.Op.gte]: 0 } },
        });
      }

      await queryInterface.createTable(
        "AdMeasurementExposures",
        {
          tokenHash: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          placementKey: {
            allowNull: false,
            onDelete: "CASCADE",
            onUpdate: "RESTRICT",
            references: { key: "key", model: "AdPlacements" },
            type: Sequelize.STRING,
          },
          campaignId: {
            allowNull: true,
            onDelete: "CASCADE",
            onUpdate: "RESTRICT",
            references: { key: "id", model: "AdCampaigns" },
            type: Sequelize.UUID,
          },
          businessDate: { allowNull: false, type: Sequelize.DATEONLY },
          servable: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          opportunityClaimed: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          servedClaimed: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          viewableClaimed: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          clickClaimed: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          expiresAt: { allowNull: false, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addConstraint("AdMeasurementExposures", {
        fields: ["servable", "campaignId"],
        name: "ad_exposure_servable_campaign",
        transaction,
        type: "check",
        where: {
          [Sequelize.Op.or]: [
            { servable: false },
            { campaignId: { [Sequelize.Op.ne]: null } },
          ],
        },
      });
      await queryInterface.addIndex("AdMeasurementExposures", ["expiresAt"], {
        transaction,
      });

      await queryInterface.createTable(
        "AdReportShares",
        {
          id: { allowNull: false, primaryKey: true, type: Sequelize.UUID },
          campaignId: {
            allowNull: false,
            onDelete: "RESTRICT",
            onUpdate: "RESTRICT",
            references: { key: "id", model: "AdCampaigns" },
            type: Sequelize.UUID,
          },
          tokenHash: {
            allowNull: false,
            type: Sequelize.STRING(64),
            unique: true,
          },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          revokedAt: { allowNull: true, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addIndex("AdReportShares", ["campaignId"], {
        transaction,
      });

      await queryInterface.sequelize.query(
        `
      CREATE FUNCTION protect_ad_campaign_immutability() RETURNS trigger AS $$
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
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER protect_ad_campaign_immutability_trigger
      BEFORE UPDATE ON "AdCampaigns"
      FOR EACH ROW EXECUTE FUNCTION protect_ad_campaign_immutability();

      CREATE FUNCTION protect_ad_report_revocation() RETURNS trigger AS $$
      BEGIN
        IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
          RAISE EXCEPTION 'Ad report revocation is irreversible';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER protect_ad_report_revocation_trigger
      BEFORE UPDATE ON "AdReportShares"
      FOR EACH ROW EXECUTE FUNCTION protect_ad_report_revocation();
    `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS protect_ad_report_revocation_trigger ON "AdReportShares";
      DROP FUNCTION IF EXISTS protect_ad_report_revocation();
      DROP TRIGGER IF EXISTS protect_ad_campaign_immutability_trigger ON "AdCampaigns";
      DROP FUNCTION IF EXISTS protect_ad_campaign_immutability();
    `);
    await queryInterface.dropTable("AdReportShares");
    await queryInterface.dropTable("AdMeasurementExposures");
    await queryInterface.dropTable("AdCampaignDailyMetrics");
    await queryInterface.dropTable("AdPlacementDailyMetrics");
    await queryInterface.dropTable("AdCampaigns");
  },
};
