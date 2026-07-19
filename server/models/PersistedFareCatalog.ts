import { DataTypes, Model } from "sequelize";
import type {
  FareCatalogResult,
  FareTripRequest,
} from "shared/contracts/fares";

import { db } from "~/lib/db";

export const PERSISTED_FARE_CATALOG_EXACT_FIELDS = [
  "departingTerminalId",
  "arrivingTerminalId",
  "tripDate",
] as const;

/** One WSDOT fare catalog (or no-fare direction) for a route and travel date. */
export class PersistedFareCatalog extends Model {
  arrivingTerminalId!: string;
  departingTerminalId!: string;
  fetchedAt!: number;
  result!: FareCatalogResult;
  tripDate!: string;
}

PersistedFareCatalog.init(
  {
    arrivingTerminalId: { allowNull: false, type: DataTypes.STRING },
    departingTerminalId: { allowNull: false, type: DataTypes.STRING },
    fetchedAt: { allowNull: false, type: DataTypes.INTEGER },
    result: { allowNull: false, type: DataTypes.JSONB },
    tripDate: { allowNull: false, type: DataTypes.DATEONLY },
  },
  {
    indexes: [
      {
        fields: [...PERSISTED_FARE_CATALOG_EXACT_FIELDS],
        name: "persisted_fare_catalogs_exact_route_date",
        unique: true,
      },
      {
        fields: ["fetchedAt"],
        name: "persisted_fare_catalogs_refresh_queue",
      },
    ],
    sequelize: db,
    modelName: "PersistedFareCatalog",
    tableName: "PersistedFareCatalogs",
  }
);

export const catalogRequestFromRow = (
  row: PersistedFareCatalog
): FareTripRequest => ({
  arrivingTerminalId: row.arrivingTerminalId,
  departingTerminalId: row.departingTerminalId,
  roundTrip: false,
  tripDate: row.tripDate as FareTripRequest["tripDate"],
});
