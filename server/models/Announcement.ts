import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** Owner-authored public notice. Body is stored as plain text and escaped on render. */
export class Announcement extends Model {
  body!: string;
  id!: string;
  published!: boolean;
  title!: string;
}

Announcement.init(
  {
    body: { allowNull: false, defaultValue: "", type: DataTypes.TEXT },
    id: { allowNull: false, primaryKey: true, type: DataTypes.UUID },
    published: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    title: { allowNull: false, defaultValue: "", type: DataTypes.STRING },
  },
  { sequelize: db, modelName: "Announcement", tableName: "Announcements" }
);
