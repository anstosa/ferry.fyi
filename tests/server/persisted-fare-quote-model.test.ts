import { describe, expect, it } from "vitest";

import {
  PersistedFareQuote,
  PERSISTED_FARE_QUOTE_EXACT_FIELDS,
} from "../../server/models/PersistedFareQuote";

describe("PersistedFareQuote model", () => {
  it("declares the migration's exact-generation unique index", () => {
    expect(PersistedFareQuote.options.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: [...PERSISTED_FARE_QUOTE_EXACT_FIELDS],
          name: "persisted_fare_quotes_exact_generation",
          unique: true,
        }),
      ])
    );
  });
});
