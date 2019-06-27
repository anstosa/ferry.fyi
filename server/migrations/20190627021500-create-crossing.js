'use strict';
module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.createTable('Crossings', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            departureTime: {
                type: Sequelize.INTEGER,
            },
            driveUpCapacity: {
                type: Sequelize.INTEGER,
            },
            hasDriveUp: {
                type: Sequelize.BOOLEAN,
            },
            hasReservations: {
                type: Sequelize.BOOLEAN,
            },
            isCancelled: {
                type: Sequelize.BOOLEAN,
            },
            reservableCapacity: {
                type: Sequelize.INTEGER,
            },
            departureId: {
                type: Sequelize.INTEGER,
            },
            arrivalId: {
                type: Sequelize.INTEGER,
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE,
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE,
            },
        });
    },
    down: (queryInterface) => {
        return queryInterface.dropTable('Crossings');
    },
};
