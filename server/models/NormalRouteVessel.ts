import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class NormalRouteVessel extends Model {
  routeId!: string;
  vesselId!: string;
  vesselName!: string;
  isNormal!: boolean;
  sampleStartDate!: string;
  sampleEndDate!: string;
  sampleDays!: number;
  daysObserved!: number;
  sailingsObserved!: number;
  positions!: number[];
  observedDates!: string[];
  calculatedAt!: number;
  inferenceNotes!: string;
}

NormalRouteVessel.init(
  {
    routeId: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    vesselId: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    vesselName: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    isNormal: {
      allowNull: false,
      type: DataTypes.BOOLEAN,
    },
    sampleStartDate: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    sampleEndDate: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    sampleDays: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    daysObserved: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    sailingsObserved: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    positions: {
      allowNull: false,
      defaultValue: [],
      type: DataTypes.JSON,
    },
    observedDates: {
      allowNull: false,
      defaultValue: [],
      type: DataTypes.JSON,
    },
    calculatedAt: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    inferenceNotes: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
  },
  { sequelize: db, modelName: "NormalRouteVessel" }
);
