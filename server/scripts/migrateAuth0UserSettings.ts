import { AppMetadata } from "shared/contracts/user";
import { isObject } from "shared/lib/objects";

import { sanitizeUserUpdate } from "~/controllers/api/user";
import {
  getAuth0ManagementAudience,
  getAuth0ManagementDomain,
} from "~/lib/auth0Config";
import { db, dbInit } from "~/lib/db";
import { UserSettings } from "~/models/UserSettings";

interface Auth0User {
  app_metadata?: unknown;
  user_id?: unknown;
}

interface Auth0TokenResponse {
  access_token?: unknown;
}

interface MigrationReport {
  dryRun: boolean;
  pages: number;
  skippedUsers: number;
  usersRead: number;
  usersWritten: number;
}

const AUTH0_PAGE_SIZE = 100;

// required env lookup
const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  // missing env guard
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
};

// auth0 management token
const getManagementToken = async ({
  audience,
  clientId,
  clientSecret,
  domain,
}: {
  audience: string;
  clientId: string;
  clientSecret: string;
  domain: string;
}): Promise<string> => {
  const response = await fetch(`https://${domain}/oauth/token`, {
    body: JSON.stringify({
      audience,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  // token response guard
  if (!response.ok) {
    throw new Error(`Auth0 token request failed: ${response.status}`);
  }
  const body = (await response.json()) as Auth0TokenResponse;
  // access token guard
  if (typeof body.access_token !== "string") {
    throw new Error("Auth0 token response did not include access_token");
  }
  return body.access_token;
};

// auth0 user page
const getAuth0UsersPage = async ({
  audience,
  page,
  token,
}: {
  audience: string;
  page: number;
  token: string;
}): Promise<Auth0User[]> => {
  const url = new URL("users", audience);
  url.searchParams.set("fields", "user_id,app_metadata");
  url.searchParams.set("include_fields", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(AUTH0_PAGE_SIZE));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // users response guard
  if (!response.ok) {
    throw new Error(`Auth0 users request failed: ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  // users list guard
  if (!Array.isArray(body)) {
    throw new Error("Auth0 users response was not a list");
  }
  return body;
};

// metadata allow-list
const getSanitizedMetadata = (
  appMetadata: unknown
): AppMetadata | undefined => {
  // metadata object guard
  if (!isObject(appMetadata)) {
    return undefined;
  }
  return sanitizeUserUpdate({ app_metadata: appMetadata }).app_metadata;
};

// migrate app metadata
const migrateUserSettings = async ({
  dryRun,
}: {
  dryRun: boolean;
}): Promise<MigrationReport> => {
  const domain = getAuth0ManagementDomain();
  const clientId = getRequiredEnv("AUTH0_SERVER_ID");
  const clientSecret = getRequiredEnv("AUTH0_SERVER_SECRET");
  const audience = getAuth0ManagementAudience();
  const token = await getManagementToken({
    audience,
    clientId,
    clientSecret,
    domain,
  });
  const report: MigrationReport = {
    dryRun,
    pages: 0,
    skippedUsers: 0,
    usersRead: 0,
    usersWritten: 0,
  };
  let page = 0;
  // auth0 pagination
  while (true) {
    const users = await getAuth0UsersPage({ audience, page, token });
    report.pages += 1;
    report.usersRead += users.length;
    // user page rows
    for (const user of users) {
      // user id guard
      if (typeof user.user_id !== "string") {
        report.skippedUsers += 1;
        continue;
      }
      const appMetadata = getSanitizedMetadata(user.app_metadata);
      // empty app state guard
      if (!appMetadata) {
        report.skippedUsers += 1;
        continue;
      }
      report.usersWritten += 1;
      // dry-run guard
      if (dryRun) {
        continue;
      }
      await UserSettings.upsert({
        appMetadata,
        subject: user.user_id,
      });
    }
    // final page guard
    if (users.length < AUTH0_PAGE_SIZE) {
      break;
    }
    page += 1;
  }
  return report;
};

// script entrypoint
const main = async (): Promise<void> => {
  await dbInit;
  const dryRun = process.argv.includes("--dry-run");
  const report = await migrateUserSettings({ dryRun });
  console.log(JSON.stringify(report, null, 2));
};

main()
  .catch((error: Error) => {
    // script failure guard
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // close db handle
    await db.close();
  });
