import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260824000100-enable-supporter-sandbox-authority.js");

const productionAuthority = {
  environment: "production",
  providerProjectKey: "revenuecat-primary",
  runtimeAuthorized: true,
};
const sandboxAuthority = {
  environment: "sandbox",
  providerProjectKey: "revenuecat-primary",
  runtimeAuthorized: true,
};

// create one isolated policy migration harness
const migrationHarness = (authoritySet = [productionAuthority]) => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    bulkUpdate: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue([
        [
          {
            authoritySet,
            generation: "1",
            registryRevision: "4",
          },
        ],
        undefined,
      ]),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

describe("supporter sandbox authority migration", () => {
  // add gated sandbox eligibility
  it("adds sandbox authority with a new durable revision", async () => {
    const { queryInterface, transaction } = migrationHarness();
    const authoritySet = [productionAuthority, sandboxAuthority];
    const authorityDigest = createHash("sha256")
      .update(JSON.stringify(authoritySet))
      .digest("hex");

    await migration.up(queryInterface);

    expect(queryInterface.bulkUpdate).toHaveBeenCalledWith(
      "SupporterAuthorityPolicies",
      expect.objectContaining({
        authorityDigest,
        authoritySet: JSON.stringify(authoritySet),
        generation: "2",
        registryRevision: "5",
      }),
      { id: "supporter-runtime-v1" },
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  // preserve an already-enabled policy
  it("does not advance an existing sandbox authority", async () => {
    const { queryInterface, transaction } = migrationHarness([
      productionAuthority,
      sandboxAuthority,
    ]);

    await migration.up(queryInterface);

    expect(queryInterface.bulkUpdate).not.toHaveBeenCalled();
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // remove only sandbox eligibility
  it("restores production-only authority on rollback", async () => {
    const { queryInterface, transaction } = migrationHarness([
      productionAuthority,
      sandboxAuthority,
    ]);

    await migration.down(queryInterface);

    expect(queryInterface.bulkUpdate).toHaveBeenCalledWith(
      "SupporterAuthorityPolicies",
      expect.objectContaining({
        authoritySet: JSON.stringify([productionAuthority]),
      }),
      { id: "supporter-runtime-v1" },
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // roll back failed authority writes
  it("rolls back when policy persistence fails", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.bulkUpdate.mockRejectedValueOnce(new Error("write failed"));

    await expect(migration.up(queryInterface)).rejects.toThrow("write failed");

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
