import Sequelize from 'sequelize';

const DIALECT_SQLITE = 'sqlite';
const DIALECT_POSTGRES = 'postgres';

export const {Op} = Sequelize;

const [, dialect] = process.env.DATABASE_URL.match(/^(\w+):\/{1,2}(.*)$/);

let db = null;
if (dialect === DIALECT_SQLITE) {
    db = new Sequelize(process.env.DATABASE_URL, {logging: false});
} else if (dialect === DIALECT_POSTGRES) {
    db = new Sequelize(process.env.DATABASE_URL, {
        dialect: DIALECT_POSTGRES,
        dialectOptions: {
            ssl: true,
        },
        // logging: false,
        protocol: DIALECT_POSTGRES,
    });
}
export {db};

export const dbInit = db.authenticate();
