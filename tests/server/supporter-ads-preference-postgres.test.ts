import { Sequelize } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acquirePostgresIntegrationLock } from "./helpers/postgresIntegrationLock";

const externalDatabaseUrl =
  process.env.SUPPORTER_ADS_PREFERENCE_TEST_DATABASE_URL;
// gate real database coverage
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

describePostgres("supporter ads preference Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAuth0Secret = process.env.AUTH0_SERVER_SECRET;
  const schemaName = `supporter_ads_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let coordination: Awaited<ReturnType<typeof acquirePostgresIntegrationLock>>;
  let database: Sequelize;
  let setSupporterAdsEnabled: typeof import("../../server/lib/supporter").setSupporterAdsEnabled;

  // create one isolated supporter schema
  beforeAll(async () => {
    admin = new Sequelize(externalDatabaseUrl ?? "", {
      dialect: "postgres",
      logging: false,
    });
    coordination = await acquirePostgresIntegrationLock(admin);
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const url = new URL(externalDatabaseUrl ?? "");
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    process.env.AUTH0_SERVER_SECRET = "supporter-ads-test-secret";
    process.env.DATABASE_URL = url.toString();
    const databaseModule = await import("../../server/lib/db");
    database = databaseModule.db;
    database.options.define = {
      ...database.options.define,
      schema: schemaName,
    };
    await database.authenticate();
    const { AdminSessionRevocation } =
      await import("../../server/models/AdminSessionRevocation");
    const { LeaderboardProfile } =
      await import("../../server/models/LeaderboardProfile");
    const { SupporterAuthorityPolicy } =
      await import("../../server/models/SupporterAuthorityPolicy");
    const { SupporterCustomer } =
      await import("../../server/models/SupporterCustomer");
    const { SupporterEntitlement } =
      await import("../../server/models/SupporterEntitlement");
    await AdminSessionRevocation.sync();
    await LeaderboardProfile.sync();
    await SupporterAuthorityPolicy.sync();
    await SupporterCustomer.sync();
    await SupporterEntitlement.sync();
    ({ setSupporterAdsEnabled } = await import("../../server/lib/supporter"));
  });

  // remove only the isolated integration schema
  afterAll(async () => {
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    // restore database configuration
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    // restore auth configuration
    if (originalAuth0Secret === undefined) {
      delete process.env.AUTH0_SERVER_SECRET;
    } else {
      process.env.AUTH0_SERVER_SECRET = originalAuth0Secret;
    }
    await coordination.commit();
    await admin.close();
  });

  // persist the preference and advance its public revision
  it("stores the preference and returns the updated status", async () => {
    const subject = "auth0|supporter-ads-postgres";
    const issuedAtSeconds = Math.floor(Date.now() / 1_000);

    const enabled = await setSupporterAdsEnabled(
      subject,
      issuedAtSeconds,
      true
    );
    const [rows] = await database.query<{
      adsEnabled: boolean;
      runtimeProjectionGeneration: string;
    }>(
      `SELECT "adsEnabled", "runtimeProjectionGeneration"
         FROM "SupporterCustomers"
        WHERE "subject" = :subject`,
      { replacements: { subject } }
    );

    expect(rows).toEqual([
      { adsEnabled: true, runtimeProjectionGeneration: "1" },
    ]);
    expect(enabled.adsEnabled).toBe(true);
    expect(enabled.revision).toBe("v1:1:1");

    const disabled = await setSupporterAdsEnabled(
      subject,
      issuedAtSeconds,
      false
    );
    expect(disabled.adsEnabled).toBe(false);
    expect(disabled.revision).toBe("v1:2:1");
  });
});
