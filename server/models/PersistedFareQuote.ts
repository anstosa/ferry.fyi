import { DataTypes, Model } from "sequelize";
import type { FareQuote } from "shared/contracts/fares";

import { db } from "~/lib/db";

/**
 * Historical, server-calculated WSDOT quote.  The unique fingerprint includes
 * WSDOT's cache-flush generation so a prior tariff can only be stale fallback.
 */
export class PersistedFareQuote extends Model {
  arrivingTerminalId!: string;
  canonicalSelections!: string;
  departingTerminalId!: string;
  fetchedAt!: number;
  policyVersion!: string;
  quote!: FareQuote;
  roundTrip!: boolean;
  sourceCacheFlushDate!: string;
  tripDate!: string;
  validFrom!: string;
  validThrough!: string;
}

PersistedFareQuote.init(
  {
    arrivingTerminalId: { allowNull: false, type: DataTypes.STRING },
    canonicalSelections: { allowNull: false, type: DataTypes.TEXT },
    departingTerminalId: { allowNull: false, type: DataTypes.STRING },
    fetchedAt: { allowNull: false, type: DataTypes.INTEGER },
    policyVersion: { allowNull: false, type: DataTypes.STRING },
    quote: { allowNull: false, type: DataTypes.JSONB },
    roundTrip: { allowNull: false, type: DataTypes.BOOLEAN },
    sourceCacheFlushDate: { allowNull: false, type: DataTypes.STRING },
    tripDate: { allowNull: false, type: DataTypes.DATEONLY },
    validFrom: { allowNull: false, type: DataTypes.DATEONLY },
    validThrough: { allowNull: false, type: DataTypes.DATEONLY },
  },
  {
    sequelize: db,
    modelName: "PersistedFareQuote",
    tableName: "PersistedFareQuotes",
  }
);
