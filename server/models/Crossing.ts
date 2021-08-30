import { Crossing as CrossingType } from "shared/models/schedules";
import { DataTypes, Model } from "sequelize";
import { DateTime } from "luxon";
import { db } from "~/lib/db";

class Crossing extends Model implements CrossingType {
  arrivalId!: string;
  departureDelta!: number | null;
  departureId!: string;
  departureTime!: number;
  driveUpCapacity!: number;
  hasDriveUp!: boolean;
  hasReservations!: boolean;
  isCancelled!: boolean;
  reservableCapacity!: number;
  totalCapacity!: number;

  isEmpty = (): boolean =>
    this.driveUpCapacity + this.reservableCapacity === this.totalCapacity;

  isFull = (): boolean =>
    this.driveUpCapacity === 0 && this.reservableCapacity === 0;

  hasPassed = (): boolean => {
    let estimatedTime = DateTime.fromSeconds(this.departureTime);
    if (this.departureDelta) {
      estimatedTime = estimatedTime.plus({
        seconds: this.departureDelta,
      });
    }
    const now = DateTime.local();
    return estimatedTime < now;
  };
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

export default Crossing;
