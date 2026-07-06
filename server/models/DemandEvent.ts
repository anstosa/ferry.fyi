import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export type DemandEventType = "school-break" | "sports" | "summer-weekend";

export class DemandEvent extends Model {
  endsAt!: number;
  eventType!: DemandEventType;
  location!: string;
  pressure!: number;
  source!: string;
  sourceId!: string;
  startsAt!: number;
  title!: string;
}

DemandEvent.init(
  {
    endsAt: DataTypes.INTEGER,
    eventType: DataTypes.STRING,
    location: DataTypes.STRING,
    pressure: DataTypes.FLOAT,
    source: DataTypes.STRING,
    sourceId: DataTypes.STRING,
    startsAt: DataTypes.INTEGER,
    title: DataTypes.STRING,
  },
  { sequelize: db, modelName: "DemandEvent" }
);
