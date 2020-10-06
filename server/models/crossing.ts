import { DataTypes, Model } from "sequelize";
import { db } from "../lib/db";

export default class Crossing extends Model {
  arrivalId!: number;
  departureDelta!: number | null;
  departureId!: number;
  departureTime!: number;
  driveUpCapacity!: number;
  hasDriveUp!: boolean;
  hasReservations!: boolean;
  isCancelled!: boolean;
  reservableCapacity!: number;
  totalCapacity!: number;
}

Crossing.init(
  {
    arrivalId: DataTypes.INTEGER,
    departureDelta: DataTypes.INTEGER,
    departureId: DataTypes.INTEGER,
    departureTime: DataTypes.INTEGER,
    driveUpCapacity: DataTypes.INTEGER,
    hasDriveUp: DataTypes.BOOLEAN,
    hasReservations: DataTypes.BOOLEAN,
    isCancelled: DataTypes.BOOLEAN,
    reservableCapacity: DataTypes.INTEGER,
    totalCapacity: DataTypes.INTEGER,
  },
  { sequelize: db, modelName: "Crossing" }
);
