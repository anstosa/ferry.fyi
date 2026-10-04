import { describe, expect, it, vi } from "vitest";

import migration from "../../server/migrations/20261003000300-allow-autocomplete-usage.js";

// capture the transaction used for both constraint changes
const fixture = () => {
  const transaction = { id: "synthetic-transaction" };
  return {
    transaction,
    query: {
      removeConstraint: vi.fn(),
      sequelize: {
        query: vi.fn(),
        transaction: vi.fn(
          async (callback: (value: unknown) => Promise<void>) => {
            // model sequelize's atomic transaction callback
            await callback(transaction);
          }
        ),
      },
    },
  };
};

describe("autocomplete usage sku migration", () => {
  // add the sku without recreating the aggregate table or losing counters
  it("extends the check constraint atomically", async () => {
    const { query, transaction } = fixture();
    await migration.up(query);
    expect(query.removeConstraint).toHaveBeenCalledWith(
      "GoogleRoutesUsageMonths",
      "google_routes_usage_sku_valid",
      { transaction }
    );
    expect(query.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('CHECK ("sku" IN (?, ?, ?))'),
      {
        replacements: [
          "compute_routes_essentials",
          "compute_routes_pro",
          "autocomplete_requests",
        ],
        transaction,
      }
    );
  });

  // rollback fails rather than deleting new-sku accounting evidence
  it("restores only the original sku constraint and propagates failures", async () => {
    const { query, transaction } = fixture();
    await migration.down(query);
    expect(query.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('CHECK ("sku" IN (?, ?))'),
      {
        replacements: ["compute_routes_essentials", "compute_routes_pro"],
        transaction,
      }
    );
    query.sequelize.query.mockRejectedValue(
      new Error("retained autocomplete counters")
    );
    await expect(migration.down(query)).rejects.toThrow(
      "retained autocomplete counters"
    );
  });
});
