"use strict";

module.exports = {
  // create the append-only generation store
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema and guards atomic
    try {
      await queryInterface.createTable(
        "LeaderboardAutomaticTerminalConfigs",
        {
          configGeneration: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.BIGINT,
          },
          schemaVersion: { allowNull: false, type: Sequelize.INTEGER },
          regionJson: { allowNull: false, type: Sequelize.TEXT },
          contentHash: {
            allowNull: false,
            type: Sequelize.STRING(64),
          },
          generatedAt: { allowNull: false, type: Sequelize.DATE },
          activatedAt: { allowNull: false, type: Sequelize.DATE },
          retainUntil: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticTerminalConfigs",
        ["activatedAt", "configGeneration"],
        {
          name: "leaderboard_automatic_terminal_configs_current",
          transaction,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticTerminalConfigs",
        ["retainUntil"],
        {
          name: "leaderboard_automatic_terminal_configs_retention",
          transaction,
        }
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardAutomaticTerminalConfigs"
          ADD CONSTRAINT leaderboard_automatic_terminal_configs_schema_positive
            CHECK ("schemaVersion" > 0),
          ADD CONSTRAINT leaderboard_automatic_terminal_configs_hash_shape
            CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT leaderboard_automatic_terminal_configs_region_json_present
            CHECK (length("regionJson") > 0),
          ADD CONSTRAINT leaderboard_automatic_terminal_configs_activation_order
            CHECK ("generatedAt" <= "activatedAt"),
          ADD CONSTRAINT leaderboard_automatic_terminal_configs_retention_order
            CHECK ("activatedAt" <= "retainUntil");

        CREATE FUNCTION protect_leaderboard_automatic_terminal_config_update()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Leaderboard automatic terminal configurations are immutable';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER protect_leaderboard_automatic_terminal_config_update_trigger
        BEFORE UPDATE ON "LeaderboardAutomaticTerminalConfigs"
        FOR EACH ROW
        EXECUTE FUNCTION protect_leaderboard_automatic_terminal_config_update();

        CREATE FUNCTION protect_leaderboard_automatic_terminal_config_retention()
        RETURNS trigger AS $$
        BEGIN
          -- reject premature pruning
          IF CURRENT_TIMESTAMP < OLD."retainUntil" THEN
            RAISE EXCEPTION 'Leaderboard automatic terminal configuration retention has not elapsed';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER protect_leaderboard_automatic_terminal_config_retention_trigger
        BEFORE DELETE ON "LeaderboardAutomaticTerminalConfigs"
        FOR EACH ROW
        EXECUTE FUNCTION protect_leaderboard_automatic_terminal_config_retention();
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // remove only this generation store
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep guard cleanup and drop atomic
    try {
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS protect_leaderboard_automatic_terminal_config_retention_trigger
          ON "LeaderboardAutomaticTerminalConfigs";
        DROP FUNCTION IF EXISTS protect_leaderboard_automatic_terminal_config_retention();
        DROP TRIGGER IF EXISTS protect_leaderboard_automatic_terminal_config_update_trigger
          ON "LeaderboardAutomaticTerminalConfigs";
        DROP FUNCTION IF EXISTS protect_leaderboard_automatic_terminal_config_update();
      `,
        { transaction }
      );
      await queryInterface.dropTable("LeaderboardAutomaticTerminalConfigs", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
