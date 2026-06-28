import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// persisted WSF bulletin
export class PersistedBulletin extends Model {
  bodyHTML!: string;
  bodyText!: string;
  date!: number;
  firstSeenAt!: number;
  id!: string;
  ignoreAll!: boolean;
  inactiveAt!: number | null;
  lastSeenAt!: number;
  level!: string;
  rawTitle!: string;
  terminalId!: string;
  title!: string;
  url!: string | null;
}

PersistedBulletin.init(
  {
    bodyHTML: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
    bodyText: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
    date: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    firstSeenAt: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    id: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING,
    },
    ignoreAll: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    inactiveAt: DataTypes.INTEGER,
    lastSeenAt: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    level: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    rawTitle: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
    terminalId: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    title: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
    url: DataTypes.TEXT,
  },
  { sequelize: db, modelName: "Bulletin" }
);
