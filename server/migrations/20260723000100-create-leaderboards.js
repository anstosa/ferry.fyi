"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("LeaderboardProfiles", {
      subject: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      displayName: { allowNull: false, defaultValue: "", type: Sequelize.STRING },
      useFullName: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      notificationsEnabled: { allowNull: false, defaultValue: true, type: Sequelize.BOOLEAN },
      optedOut: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.createTable("LeaderboardTerminalPresences", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      subject: { allowNull: false, type: Sequelize.STRING },
      terminalId: { allowNull: false, type: Sequelize.STRING },
      lastCreditedAt: { allowNull: true, type: Sequelize.DATE },
      exitedAt: { allowNull: true, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("LeaderboardTerminalPresences", ["subject", "terminalId"], { unique: true });
    await queryInterface.createTable("LeaderboardCheckins", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      subject: { allowNull: false, type: Sequelize.STRING },
      kind: { allowNull: false, type: Sequelize.STRING },
      entityId: { allowNull: false, type: Sequelize.STRING },
      occurredAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("LeaderboardCheckins", ["kind", "entityId", "occurredAt"]);
    await queryInterface.addIndex("LeaderboardCheckins", ["subject", "kind", "entityId", "occurredAt"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("LeaderboardCheckins");
    await queryInterface.dropTable("LeaderboardTerminalPresences");
    await queryInterface.dropTable("LeaderboardProfiles");
  },
};
