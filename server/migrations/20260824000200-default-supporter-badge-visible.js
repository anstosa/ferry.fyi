"use strict";

// define one public badge preference column
const badgeColumn = (Sequelize, defaultValue) => ({
  allowNull: false,
  defaultValue,
  type: Sequelize.BOOLEAN,
});

module.exports = {
  // enable badges until a supporter explicitly chooses otherwise
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema and active account updates atomic
    try {
      await queryInterface.addColumn(
        "LeaderboardProfiles",
        "supporterBadgePreferenceSet",
        badgeColumn(Sequelize, false),
        { transaction }
      );
      await queryInterface.changeColumn(
        "LeaderboardProfiles",
        "supporterBadgeVisible",
        badgeColumn(Sequelize, true),
        { transaction }
      );
      await queryInterface.sequelize.query(
        `UPDATE "LeaderboardProfiles" AS profile
            SET "supporterBadgeVisible" = TRUE,
                "updatedAt" = NOW()
          WHERE EXISTS (
            SELECT 1
              FROM "SupporterCustomers" AS customer
              JOIN "SupporterEntitlements" AS entitlement
                ON entitlement."customerId" = customer."id"
             WHERE customer."subject" = profile."subject"
               AND entitlement."entitlementIdentifier" = 'ferry_fyi_supporter'
               AND entitlement."accessState" = 'active'
               AND (
                 entitlement."activeUntil" IS NULL
                 OR entitlement."activeUntil" > NOW()
               )
          )`,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // restore the legacy default without overwriting user choices
  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema rollback atomic
    try {
      await queryInterface.changeColumn(
        "LeaderboardProfiles",
        "supporterBadgeVisible",
        badgeColumn(Sequelize, false),
        { transaction }
      );
      await queryInterface.removeColumn(
        "LeaderboardProfiles",
        "supporterBadgePreferenceSet",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
