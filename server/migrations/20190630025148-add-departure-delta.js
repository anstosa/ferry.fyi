'use strict';

module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.addColumn(
            'Crossings',
            'departureDelta',
            Sequelize.INTEGER
        );
    },

    down: (queryInterface) => {
        return queryInterface.removeColumn('Crossings', 'departureDelta');
    },
};
