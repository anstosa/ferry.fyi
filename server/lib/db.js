require('dotenv').config();

import Sequelize from 'sequelize';

export const {Op} = Sequelize;

export const db = new Sequelize(process.env.DATABASE_URL, {logging: false});

export const dbInit = db.authenticate();
