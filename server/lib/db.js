import Sequelize from 'sequelize';

export const {Op} = Sequelize;

console.log(process.env.DATABASE_URL);
export const db = new Sequelize(process.env.DATABASE_URL, {logging: false});

export const dbInit = db.authenticate();
