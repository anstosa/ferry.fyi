"use strict";

module.exports = {
  // add DB-backed route favorites outside app metadata
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("UserSettings", "favoriteRouteIds", {
      allowNull: false,
      defaultValue: [],
      type: Sequelize.JSONB,
    });

    await queryInterface.sequelize.query(`
      UPDATE "UserSettings"
      SET "favoriteRouteIds" = COALESCE("appMetadata"->'favoriteRouteIds', '[]'::jsonb),
          "appMetadata" = "appMetadata" - 'favoriteRouteIds',
          "updatedAt" = NOW()
      WHERE "appMetadata" ? 'favoriteRouteIds'
    `);
  },

  // restore route favorites to app metadata for rollback
  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      UPDATE "UserSettings"
      SET "appMetadata" = jsonb_set(
            "appMetadata",
            '{favoriteRouteIds}',
            COALESCE("favoriteRouteIds", '[]'::jsonb),
            true
          ),
          "updatedAt" = NOW()
      WHERE jsonb_array_length(COALESCE("favoriteRouteIds", '[]'::jsonb)) > 0
    `);

    await queryInterface.removeColumn("UserSettings", "favoriteRouteIds");
  },
};
