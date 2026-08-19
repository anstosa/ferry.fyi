import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
const terminalConfigs = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  findByPk: vi.fn(),
  findOne: vi.fn(),
}));
const terminals = vi.hoisted(() => ({ getAll: vi.fn() }));

vi.mock("~/lib/db", () => ({ db: database }));
vi.mock("~/models/LeaderboardAutomaticTerminalConfig", () => ({
  LeaderboardAutomaticTerminalConfig: terminalConfigs,
}));
vi.mock("~/models/Terminal", () => ({ Terminal: terminals }));

import {
  AUTOMATIC_TERMINAL_CANDIDATE_RETENTION_MS,
  AutomaticTerminalConfigError,
  automaticTerminalConfigRetentionMs,
  createAutomaticTerminalConfigGeneration,
  deriveAutomaticTerminalRegions,
  loadAutomaticTerminalConfigGeneration,
  loadCurrentAutomaticTerminalConfig,
  pruneAutomaticTerminalConfigs,
} from "../../server/services/leaderboardAutomaticNativeConfig";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260817000100-create-leaderboard-automatic-terminal-configs.js");
const transaction = { commit: vi.fn(), rollback: vi.fn() };
const generationOptions = {
  androidRegionBudget: 100,
  futureToleranceMs: 60_000,
  iosRegionBudget: 20,
  now: new Date("2026-08-17T12:00:00.000Z"),
  transportRetentionMs: 5 * 60_000,
};

// build one hydrated runtime terminal
const terminal = (
  id: string,
  latitude: number,
  longitude: number
): Record<string, unknown> => ({
  id,
  location: { latitude, longitude },
});

const canonicalTerminalIds = Object.keys(TERMINAL_DATA_OVERRIDES);

// compare identifiers by canonical utf-8 bytes
const compareTerminalIds = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

// hydrate every canonical id from runtime-only coordinates
const hydratedTerminalSet = (): Record<string, Record<string, unknown>> => {
  const result: Record<string, Record<string, unknown>> = {};
  // hydrate each canonical terminal
  for (const terminalId of canonicalTerminalIds) {
    const coordinateOffset = Number(terminalId) / 1000;
    result[terminalId] = terminal(
      terminalId,
      47 + coordinateOffset,
      -122 - coordinateOffset
    );
  }
  return result;
};

// require a fixed configuration failure code
const expectConfigError = async (
  action: () => unknown | Promise<unknown>,
  code: AutomaticTerminalConfigError["code"]
): Promise<void> => {
  // normalize sync and async failures
  try {
    await action();
    throw new Error("expected configuration failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AutomaticTerminalConfigError);
    expect((error as AutomaticTerminalConfigError).code).toBe(code);
  }
};

// cover deterministic hydrated generation
describe("automatic terminal configuration", () => {
  // reset isolated persistence doubles
  beforeEach(() => {
    vi.clearAllMocks();
    database.query.mockResolvedValue([[], 0]);
    // execute managed transactions immediately
    database.transaction.mockImplementation((callback) =>
      callback(transaction)
    );
    // return immutable inserted values
    terminalConfigs.create.mockImplementation((values) => ({
      ...values,
    }));
    terminalConfigs.destroy.mockResolvedValue(0);
    terminalConfigs.findByPk.mockResolvedValue(null);
    terminalConfigs.findOne.mockResolvedValue(null);
    terminals.getAll.mockReturnValue(hydratedTerminalSet());
  });

  // prove canonical order, scaling, and digest
  it("creates deterministic sorted E7 geometry and hash", async () => {
    const result =
      await createAutomaticTerminalConfigGeneration(generationOptions);

    expect(result.configGeneration).toBe(1);
    // compare all canonical sorted identifiers
    expect(result.regions.map(({ terminalId }) => terminalId)).toEqual(
      [...canonicalTerminalIds].sort(compareTerminalIds)
    );
    expect(result.regions[0]).toEqual({
      configGeneration: 1,
      latitudeE7: 470_010_000,
      longitudeE7: -1_220_010_000,
      radiusMillimeters: 304_800,
      terminalId: "1",
    });
    expect(JSON.parse(result.regionJson)).toHaveLength(
      canonicalTerminalIds.length
    );
    expect(result.regionJson).not.toContain("configGeneration");
    // verify every scaled coordinate
    for (const region of result.regions) {
      expect(Number.isInteger(region.latitudeE7)).toBe(true);
      expect(Number.isInteger(region.longitudeE7)).toBe(true);
    }
    expect(result.contentHash).toBe(
      createHash("sha256").update(result.regionJson).digest("hex")
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("LOCK TABLE"),
      { transaction }
    );
  });

  // prove the exact retention formula
  it("retains generations for candidate, future, and transport windows", async () => {
    const result =
      await createAutomaticTerminalConfigGeneration(generationOptions);

    expect(result.retainUntil.getTime()).toBe(
      generationOptions.now.getTime() +
        AUTOMATIC_TERMINAL_CANDIDATE_RETENTION_MS +
        generationOptions.futureToleranceMs +
        generationOptions.transportRetentionMs
    );
    expect(
      automaticTerminalConfigRetentionMs(43_200_000, 60_000, 300_000)
    ).toBe(43_560_000);
  });

  // prove reverts never reuse the durable generation
  it("creates a monotonic generation for repeated content", async () => {
    terminalConfigs.findOne
      .mockResolvedValueOnce({ configGeneration: "6" })
      .mockResolvedValueOnce({ configGeneration: "7" });

    const first =
      await createAutomaticTerminalConfigGeneration(generationOptions);
    const reverted =
      await createAutomaticTerminalConfigGeneration(generationOptions);

    expect(first.configGeneration).toBe(7);
    expect(reverted.configGeneration).toBe(8);
    expect(reverted.contentHash).toBe(first.contentHash);
    expect(reverted.regionJson).toBe(first.regionJson);
  });

  // prove sparse overrides are never treated as hydration
  it("rejects the sparse static terminal override file", async () => {
    terminals.getAll.mockReturnValue(TERMINAL_DATA_OVERRIDES);

    await expectConfigError(
      () => createAutomaticTerminalConfigGeneration(generationOptions),
      "sparse_terminal"
    );
  });

  // reject every invalid runtime hydration shape
  it.each([
    [
      "missing coordinate",
      {
        ...hydratedTerminalSet(),
        "1": { id: "1", location: {} },
      },
      "invalid_coordinate",
    ],
    [
      "NaN coordinate",
      {
        ...hydratedTerminalSet(),
        "1": terminal("1", Number.NaN, -122),
      },
      "invalid_coordinate",
    ],
    [
      "out-of-range coordinate",
      {
        ...hydratedTerminalSet(),
        "1": terminal("1", 91, -122),
      },
      "invalid_coordinate",
    ],
    [
      "duplicate id",
      {
        ...hydratedTerminalSet(),
        "3": terminal("1", 48, -123),
      },
      "duplicate_terminal",
    ],
  ])("rejects %s", async (_label, runtimeTerminals, code) => {
    terminals.getAll.mockReturnValue(runtimeTerminals);

    await expectConfigError(
      () => createAutomaticTerminalConfigGeneration(generationOptions),
      code as AutomaticTerminalConfigError["code"]
    );
  });

  // reject omitted hydrated terminals
  it("rejects a missing canonical terminal", async () => {
    const incomplete = hydratedTerminalSet();
    // omit one otherwise hydrated terminal
    delete incomplete[canonicalTerminalIds[0]];
    terminals.getAll.mockReturnValue(incomplete);

    await expectConfigError(
      () => createAutomaticTerminalConfigGeneration(generationOptions),
      "incomplete_terminal_set"
    );
  });

  // reject extra hydrated terminals
  it("rejects a terminal outside the canonical set", async () => {
    terminals.getAll.mockReturnValue({
      ...hydratedTerminalSet(),
      extra: terminal("extra", 47, -122),
    });

    await expectConfigError(
      () => createAutomaticTerminalConfigGeneration(generationOptions),
      "incomplete_terminal_set"
    );
  });

  // reject invalid radii before persistence
  it("rejects invalid radii", async () => {
    await expectConfigError(
      () =>
        createAutomaticTerminalConfigGeneration({
          ...generationOptions,
          radiusMillimeters: 0,
        }),
      "invalid_radius"
    );
  });

  // reject any platform's incomplete region budget
  it("rejects a terminal count above either platform budget", async () => {
    await expectConfigError(
      () =>
        createAutomaticTerminalConfigGeneration({
          ...generationOptions,
          iosRegionBudget: 1,
        }),
      "over_platform_budget"
    );
    await expectConfigError(
      () =>
        createAutomaticTerminalConfigGeneration({
          ...generationOptions,
          androidRegionBudget: 1,
        }),
      "over_platform_budget"
    );
  });

  // reject unsafe retention parameters
  it("rejects invalid retention policy", async () => {
    await expectConfigError(
      () => automaticTerminalConfigRetentionMs(0, 0, 0),
      "invalid_policy"
    );
    await expectConfigError(
      () =>
        createAutomaticTerminalConfigGeneration({
          ...generationOptions,
          now: new Date(8_640_000_000_000_000),
        }),
      "invalid_policy"
    );
    await expectConfigError(
      () => automaticTerminalConfigRetentionMs(43_200_000, -1, 0),
      "invalid_policy"
    );
    expect(terminalConfigs.create).not.toHaveBeenCalled();
  });

  // prove restart uses exact durable bytes
  it("reloads current and historical durable generations without hydration", async () => {
    const generated =
      await createAutomaticTerminalConfigGeneration(generationOptions);
    const storedRow = terminalConfigs.create.mock.calls[0][0];
    // fail if restart tries to regenerate
    terminals.getAll.mockImplementation(() => {
      throw new Error("unexpected runtime regeneration");
    });
    terminalConfigs.findOne.mockResolvedValue(storedRow);
    terminalConfigs.findByPk.mockResolvedValue(storedRow);

    await expect(loadCurrentAutomaticTerminalConfig()).resolves.toEqual(
      generated
    );
    await expect(
      loadAutomaticTerminalConfigGeneration(generated.configGeneration)
    ).resolves.toEqual(generated);
    expect(terminalConfigs.findByPk).toHaveBeenCalledWith(1);

    const proofTransaction = { id: "proof-transaction" };
    await expect(
      loadAutomaticTerminalConfigGeneration(
        generated.configGeneration,
        undefined,
        proofTransaction as never
      )
    ).resolves.toEqual(generated);
    expect(terminalConfigs.findByPk).toHaveBeenCalledWith(1, {
      transaction: proofTransaction,
    });
  });

  // fail readiness on missing durable state
  it("fails closed when durable configuration is missing", async () => {
    await expectConfigError(
      () => loadCurrentAutomaticTerminalConfig(),
      "missing_durable_config"
    );
    await expectConfigError(
      () => loadAutomaticTerminalConfigGeneration(99),
      "missing_durable_config"
    );
  });

  // fail readiness on stored digest mismatch
  it("fails closed on hash mismatch", async () => {
    await createAutomaticTerminalConfigGeneration(generationOptions);
    const storedRow = terminalConfigs.create.mock.calls[0][0];
    terminalConfigs.findOne.mockResolvedValue({
      ...storedRow,
      contentHash: "0".repeat(64),
    });

    await expectConfigError(
      () => loadCurrentAutomaticTerminalConfig(),
      "hash_mismatch"
    );
  });

  // fail readiness on stale stored schemas
  it("fails closed on stale schema", async () => {
    await createAutomaticTerminalConfigGeneration(generationOptions);
    const storedRow = terminalConfigs.create.mock.calls[0][0];
    terminalConfigs.findOne.mockResolvedValue({
      ...storedRow,
      schemaVersion: 0,
    });

    await expectConfigError(
      () => loadCurrentAutomaticTerminalConfig(),
      "stale_schema"
    );
  });

  // keep current generation while pruning elapsed history
  it("prunes only elapsed non-current generations", async () => {
    terminalConfigs.findOne.mockResolvedValue({ configGeneration: "5" });
    terminalConfigs.destroy.mockResolvedValue(2);
    const now = new Date("2026-08-18T00:00:00.000Z");

    await expect(pruneAutomaticTerminalConfigs(now)).resolves.toBe(2);
    expect(terminalConfigs.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction,
        where: expect.objectContaining({ retainUntil: expect.any(Object) }),
      })
    );
  });

  // validate derivation independently of persistence
  it("derives one complete generation from Terminal.getAll", () => {
    const regions = deriveAutomaticTerminalRegions(4, {
      androidRegionBudget: 100,
      iosRegionBudget: 20,
    });

    expect(regions).toHaveLength(canonicalTerminalIds.length);
    expect(
      regions.every(({ configGeneration }) => configGeneration === 4)
    ).toBe(true);
  });
});

// cover postgres schema guards
describe("automatic terminal configuration migration", () => {
  // create migration doubles
  const createQueryInterface = () => ({
    addIndex: vi.fn(),
    createTable: vi.fn(),
    dropTable: vi.fn(),
    sequelize: {
      query: vi.fn(),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  });
  const Sequelize = {
    BIGINT: "BIGINT",
    DATE: "DATE",
    INTEGER: "INTEGER",
    STRING: vi.fn((length) => `STRING(${length})`),
    TEXT: "TEXT",
  };

  // reset transaction evidence
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // prove required columns, indexes, and database guards
  it("creates the append-only retained generation store", async () => {
    const queryInterface = createQueryInterface();

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "LeaderboardAutomaticTerminalConfigs",
      expect.objectContaining({
        activatedAt: expect.objectContaining({ allowNull: false }),
        configGeneration: expect.objectContaining({
          allowNull: false,
          primaryKey: true,
          type: "BIGINT",
        }),
        contentHash: expect.objectContaining({ allowNull: false }),
        generatedAt: expect.objectContaining({ allowNull: false }),
        regionJson: expect.objectContaining({ allowNull: false, type: "TEXT" }),
        retainUntil: expect.objectContaining({ allowNull: false }),
        schemaVersion: expect.objectContaining({ allowNull: false }),
      }),
      { transaction }
    );
    const guardSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(guardSql).toContain(
      "protect_leaderboard_automatic_terminal_config_update"
    );
    expect(guardSql).toContain("BEFORE UPDATE");
    expect(guardSql).toContain(
      "protect_leaderboard_automatic_terminal_config_retention"
    );
    expect(guardSql).toContain('CURRENT_TIMESTAMP < OLD."retainUntil"');
    expect(guardSql).toContain("BEFORE DELETE");
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  // prove migration cleanup targets only owned objects
  it("drops guards before dropping the owned table", async () => {
    const queryInterface = createQueryInterface();

    await migration.down(queryInterface);

    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "DROP TRIGGER IF EXISTS protect_leaderboard_automatic_terminal_config_retention_trigger"
      ),
      { transaction }
    );
    expect(queryInterface.dropTable).toHaveBeenCalledWith(
      "LeaderboardAutomaticTerminalConfigs",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove partial migration failures roll back
  it("rolls back when guard installation fails", async () => {
    const queryInterface = createQueryInterface();
    queryInterface.sequelize.query.mockRejectedValue(new Error("sql failed"));

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "sql failed"
    );
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
