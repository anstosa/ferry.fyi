import { isString } from "lodash";
import { Sequelize } from "sequelize";

const DIALECT_POSTGRES = "postgres";

if (!isString(process.env.DATABASE_URL)) {
  throw new Error("Must provide DATABASE_URL");
}

export const db = new Sequelize(process.env.DATABASE_URL, {
  dialect: DIALECT_POSTGRES,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: Boolean(process.env.DEBUG),
  protocol: DIALECT_POSTGRES,
  pool: {
    max: 10,
  },
});

export const dbInit = db.authenticate();
