import {db} from '../lib/db';
import Sequelize, {Model} from 'sequelize';

export default class Crossing extends Model {}
Crossing.init(
    {
        arrivalId: Sequelize.INTEGER,
        departureId: Sequelize.INTEGER,
        departureTime: Sequelize.INTEGER,
        driveUpCapacity: Sequelize.INTEGER,
        hasDriveUp: Sequelize.BOOLEAN,
        hasReservations: Sequelize.BOOLEAN,
        isCancelled: Sequelize.BOOLEAN,
        reservableCapacity: Sequelize.INTEGER,
        totalCapacity: Sequelize.INTEGER,
    },
    {sequelize: db, modelName: 'Crossing'}
);
