"use strict";

module.exports = {
  // keep operator coordinates independent of wsf refreshes
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // create both point pairs atomically
    try {
      await queryInterface.createTable(
        "TerminalLocationSettings",
        {
          terminalId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(20),
          },
          boothLatitude: { allowNull: true, type: Sequelize.DOUBLE },
          boothLongitude: { allowNull: true, type: Sequelize.DOUBLE },
          dockLatitude: { allowNull: true, type: Sequelize.DOUBLE },
          dockLongitude: { allowNull: true, type: Sequelize.DOUBLE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      // reject incomplete pairs and points outside the supported ferry region
      for (const point of ["booth", "dock"]) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "TerminalLocationSettings"
           ADD CONSTRAINT "terminal_locations_${point}_valid" CHECK (
             ("${point}Latitude" IS NULL AND "${point}Longitude" IS NULL) OR
             ("${point}Latitude" IS NOT NULL AND "${point}Longitude" IS NOT NULL AND
              "${point}Latitude" BETWEEN 45 AND 50 AND
              "${point}Longitude" BETWEEN -125 AND -119)
           )`,
          { transaction }
        );
      }
      await transaction.commit();
    } catch (error) {
      // remove partial schema work
      await transaction.rollback();
      throw error;
    }
  },
  // remove only the owner coordinate table
  down: async (queryInterface) => {
    await queryInterface.dropTable("TerminalLocationSettings");
  },
};
