import { describe, expect, it } from "vitest";

import {
  PERSISTED_FARE_CATALOG_EXACT_FIELDS,
  PersistedFareCatalog,
} from "../../server/models/PersistedFareCatalog";

describe("PersistedFareCatalog model", () => {
  it("declares indexes for exact route/date reads and the refresh queue", () => {
    expect(PersistedFareCatalog.options.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: [...PERSISTED_FARE_CATALOG_EXACT_FIELDS],
          name: "persisted_fare_catalogs_exact_route_date",
          unique: true,
        }),
        expect.objectContaining({
          fields: ["fetchedAt"],
          name: "persisted_fare_catalogs_refresh_queue",
        }),
      ])
    );
  });
});
