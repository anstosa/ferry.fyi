import { Sequelize } from "sequelize";
import type { Terminal } from "shared/contracts/terminals";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTerminalLocationService } from "../../server/lib/terminalLocations";
import migration from "../../server/migrations/20261003000400-create-terminal-location-settings.js";

const url = process.env.BOAT_TEST_DATABASE_URL;
// permit schema mutation only in the explicitly disposable local test database
const enabled = Boolean(
  url &&
  /^postgres:\/\/boat_test:boat_test@127\.0\.0\.1:16632\/boat_test$/u.test(url)
);

describe.runIf(enabled)("terminal location postgres rehearsal", () => {
  const database = new Sequelize(
    url ?? "postgres://boat_test:boat_test@127.0.0.1:16632/boat_test",
    { logging: false }
  );
  const query = database.getQueryInterface();
  const terminal = {
    id: "7",
    name: "Seattle",
    abbreviation: "SEA",
    location: { latitude: 47.6, longitude: -122.33 },
  } as Terminal;
  const booth = { latitude: 47.6001, longitude: -122.3371 };
  const dock = { latitude: 47.601, longitude: -122.339 };
  // create the settings table in the isolated database only
  beforeAll(async () => {
    await database.authenticate();
    await migration.up(query, Sequelize);
  });
  // remove only this rehearsal schema and release connections
  afterAll(async () => {
    await migration.down(query);
    await database.close();
    const { db } = await import("../../server/lib/db");
    await db.close();
  });

  // actual default model reads must see commits from another service instance
  it("persists two independent points across service instances and upstream refreshes", async () => {
    const { TerminalLocationSetting } =
      await import("../../server/models/TerminalLocationSetting");
    TerminalLocationSetting.init(TerminalLocationSetting.getAttributes(), {
      sequelize: database,
      modelName: "TerminalLocationSetting",
      tableName: "TerminalLocationSettings",
      timestamps: true,
    });
    const first = createTerminalLocationService({
      getTerminals: async () => [terminal],
    });
    const second = createTerminalLocationService({
      getTerminals: async () => [terminal],
    });
    const saved = await first.save("7", { booth, dock });
    expect(saved).toMatchObject({
      booth,
      dock,
      defaultDock: { latitude: 47.6, longitude: -122.33 },
    });
    expect(saved.updatedAt).toMatch(/^\d{4}-/);
    expect(await second.getBooth("7")).toEqual(booth);
    expect(await second.getDocks()).toEqual({ "7": dock });
    terminal.location.latitude = 47.602;
    expect((await second.list()).terminals[0]).toMatchObject({
      booth,
      dock,
      defaultDock: { latitude: 47.602 },
    });
    await first.save("7", { booth: null, dock: null });
    expect(await second.getBooth("7")).toBeNull();
    expect(await second.getDocks()).toEqual({});
  });

  // enforce regional bounds and complete nullable pairs in real postgres
  it("rejects incomplete pairs and invalid coordinates at the storage boundary", async () => {
    // each invalid insert must fail independently without creating a row
    for (const invalid of [
      { boothLatitude: 47.6, boothLongitude: null },
      { dockLatitude: null, dockLongitude: -122.3 },
      { boothLatitude: 60, boothLongitude: -122.3 },
      { boothLatitude: 47.6, boothLongitude: Infinity },
      { dockLatitude: NaN, dockLongitude: -122.3 },
    ]) {
      await expect(
        query.bulkInsert("TerminalLocationSettings", [
          {
            terminalId: "invalid",
            createdAt: new Date(),
            updatedAt: new Date(),
            ...invalid,
          },
        ])
      ).rejects.toThrow();
    }
    const [rows] = await database.query(
      'SELECT "terminalId" FROM "TerminalLocationSettings" WHERE "terminalId"=\'invalid\''
    );
    expect(rows).toEqual([]);
  });
});
