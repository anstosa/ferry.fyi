import { beforeEach, describe, expect, it, vi } from "vitest";

import migration from "../../server/migrations/20261003000400-create-terminal-location-settings.js";

describe("terminal location schema", () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  // isolate migration effects and transaction evidence
  const makeQuery = () => ({
    createTable: vi.fn(),
    dropTable: vi.fn(),
    sequelize: {
      transaction: vi.fn().mockResolvedValue(transaction),
      query: vi.fn(),
    },
  });
  const sequelize = { STRING: vi.fn(), DOUBLE: "DOUBLE", DATE: "DATE" };
  // reset migration doubles between cases
  beforeEach(() => vi.clearAllMocks());
  // keep both nullable pairs and regional guards in one transaction
  it("creates a per-terminal persistent table and complete-point checks", async () => {
    const query = makeQuery();
    await migration.up(query, sequelize);
    expect(query.createTable).toHaveBeenCalledWith(
      "TerminalLocationSettings",
      expect.objectContaining({
        terminalId: expect.objectContaining({
          primaryKey: true,
          allowNull: false,
        }),
        boothLatitude: expect.objectContaining({ allowNull: true }),
        dockLongitude: expect.objectContaining({ allowNull: true }),
      }),
      { transaction }
    );
    expect(query.sequelize.query).toHaveBeenCalledTimes(2);
    expect(query.sequelize.query.mock.calls[0][0]).toContain(
      '"boothLatitude" IS NOT NULL'
    );
    expect(query.sequelize.query.mock.calls[1][0]).toContain(
      '"dockLongitude" BETWEEN -125 AND -119'
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
  // schema failures must not leave partial point constraints
  it("rolls back failed schema creation", async () => {
    const query = makeQuery();
    query.sequelize.query.mockRejectedValueOnce(
      new Error("constraint failure")
    );
    await expect(migration.up(query, sequelize)).rejects.toThrow(
      "constraint failure"
    );
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
  // rollback owns only the newly introduced settings table
  it("drops only terminal settings", async () => {
    const query = makeQuery();
    await migration.down(query);
    expect(query.dropTable).toHaveBeenCalledWith("TerminalLocationSettings");
  });
});
