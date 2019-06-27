'use strict';

module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.addColumn(
            'Crossings',
            'totalCapacity',
            Sequelize.INTEGER
        );
    },

    down: (queryInterface) => {
        return queryInterface.removeColumn('Crossings', 'totalCapacity');
    },
};
