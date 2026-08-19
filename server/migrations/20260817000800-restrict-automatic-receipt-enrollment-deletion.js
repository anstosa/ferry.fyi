"use strict";

const receiptTable = "LeaderboardAutomaticCandidateReceipts";
const enrollmentConstraint =
  "LeaderboardAutomaticCandidateReceipts_enrollmentId_fkey";

module.exports = {
  // prevent enrollment cleanup from cascading retained receipts
  up: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    // replace the foreign key atomically
    try {
      await queryInterface.removeConstraint(
        receiptTable,
        enrollmentConstraint,
        {
          transaction,
        }
      );
      await queryInterface.addConstraint(receiptTable, {
        fields: ["enrollmentId"],
        name: enrollmentConstraint,
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
        references: {
          field: "enrollmentId",
          table: "LeaderboardAutomaticEnrollments",
        },
        transaction,
        type: "foreign key",
      });
      await transaction.commit();
    } catch (error) {
      // roll back partial foreign key replacement
      await transaction.rollback();
      throw error;
    }
  },

  // restore the original cascade behavior
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    // replace the foreign key atomically
    try {
      await queryInterface.removeConstraint(
        receiptTable,
        enrollmentConstraint,
        {
          transaction,
        }
      );
      await queryInterface.addConstraint(receiptTable, {
        fields: ["enrollmentId"],
        name: enrollmentConstraint,
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
        references: {
          field: "enrollmentId",
          table: "LeaderboardAutomaticEnrollments",
        },
        transaction,
        type: "foreign key",
      });
      await transaction.commit();
    } catch (error) {
      // roll back partial foreign key restoration
      await transaction.rollback();
      throw error;
    }
  },
};
