import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";
import type { CapacityReportingState } from "~/lib/fillTiming";

export type CapacityObservationSourceKind = "wsf-direct" | "repair-derived";
export type CapacityObservationRepairReason = "delayed-predecessor-missing";

/** immutable WSF capacity evidence */
export class CapacityObservation extends Model {
  allocationGroupId!: string | null;
  arrivalId!: string;
  departureEstimateDriveUpSpaces!: number | null;
  departureId!: string;
  departureTime!: number | string;
  driveUpDisplayed!: boolean;
  driveUpSpaces!: number | null;
  forecastFullProbability!: number | null;
  forecastFullRisk!: string | null;
  forecastSource!: string | null;
  id!: number | string;
  isCancelled!: boolean;
  maxSpaceCount!: number | null;
  modelInputSchemaVersion!: string;
  pollId!: string;
  projectedDepartureAt!: number | string | null;
  providerReportedAt!: number | string | null;
  receivedAt!: number | string;
  repairReason!: CapacityObservationRepairReason | null;
  reportingStartedAtReceipt!: number | string | null;
  reportingStateAtReceipt!: CapacityReportingState;
  reservableDisplayed!: boolean;
  reservableSpaces!: number | null;
  sourceKind!: CapacityObservationSourceKind;
  triggerAllocationGroupId!: string | null;
  triggerPollId!: string | null;
  usableForFillLabel!: boolean;
  vesselId!: string | null;
}

// define immutable observation storage
CapacityObservation.init(
  {
    allocationGroupId: { allowNull: true, type: DataTypes.UUID },
    arrivalId: { allowNull: false, type: DataTypes.STRING(16) },
    departureEstimateDriveUpSpaces: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    departureId: { allowNull: false, type: DataTypes.STRING(16) },
    departureTime: { allowNull: false, type: DataTypes.BIGINT },
    driveUpDisplayed: { allowNull: false, type: DataTypes.BOOLEAN },
    driveUpSpaces: { allowNull: true, type: DataTypes.INTEGER },
    forecastFullProbability: { allowNull: true, type: DataTypes.DOUBLE },
    forecastFullRisk: { allowNull: true, type: DataTypes.STRING(24) },
    forecastSource: { allowNull: true, type: DataTypes.STRING(24) },
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.BIGINT,
    },
    isCancelled: { allowNull: false, type: DataTypes.BOOLEAN },
    maxSpaceCount: { allowNull: true, type: DataTypes.INTEGER },
    modelInputSchemaVersion: {
      allowNull: false,
      type: DataTypes.STRING(32),
    },
    pollId: { allowNull: false, type: DataTypes.UUID },
    projectedDepartureAt: { allowNull: true, type: DataTypes.BIGINT },
    providerReportedAt: { allowNull: true, type: DataTypes.BIGINT },
    receivedAt: { allowNull: false, type: DataTypes.BIGINT },
    repairReason: { allowNull: true, type: DataTypes.STRING(48) },
    reportingStartedAtReceipt: { allowNull: true, type: DataTypes.BIGINT },
    reportingStateAtReceipt: {
      allowNull: false,
      type: DataTypes.STRING(32),
    },
    reservableDisplayed: { allowNull: false, type: DataTypes.BOOLEAN },
    reservableSpaces: { allowNull: true, type: DataTypes.INTEGER },
    sourceKind: { allowNull: false, type: DataTypes.STRING(24) },
    triggerAllocationGroupId: { allowNull: true, type: DataTypes.UUID },
    triggerPollId: { allowNull: true, type: DataTypes.UUID },
    usableForFillLabel: { allowNull: false, type: DataTypes.BOOLEAN },
    vesselId: { allowNull: true, type: DataTypes.STRING(32) },
  },
  {
    indexes: [
      {
        fields: ["pollId", "allocationGroupId", "arrivalId", "departureTime"],
        name: "capacity_observations_direct_identity",
        unique: true,
      },
      {
        fields: [
          "triggerPollId",
          "departureId",
          "arrivalId",
          "departureTime",
          "repairReason",
        ],
        name: "capacity_observations_repair_identity",
        unique: true,
      },
      {
        fields: ["departureId", "arrivalId", "departureTime", "receivedAt"],
        name: "capacity_observations_sailing_time",
      },
      {
        fields: ["allocationGroupId"],
        name: "capacity_observations_allocation_group",
      },
      {
        fields: ["receivedAt"],
        name: "capacity_observations_retention",
      },
    ],
    modelName: "CapacityObservation",
    sequelize: db,
    tableName: "CapacityObservations",
    timestamps: false,
  }
);

export default CapacityObservation;
