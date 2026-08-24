#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URLSearchParams } from "node:url";

const APP_STORE_CONNECT_API_ORIGIN = "https://api.appstoreconnect.apple.com";
const APP_STORE_DESCRIPTION_LIMIT = 4000;

/** Reads one required environment variable. */
const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();
  // required value guard
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

/** Encodes one JSON Web Token segment. */
const encodeTokenSegment = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Creates one App Store Connect API token. */
export const createAppStoreConnectToken = ({
  issuerId,
  keyId,
  privateKey,
  now = Math.floor(Date.now() / 1000),
}) => {
  const header = encodeTokenSegment({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = encodeTokenSegment({
    aud: "appstoreconnect-v1",
    exp: now + 19 * 60,
    iat: now,
    iss: issuerId,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    dsaEncoding: "ieee-p1363",
    key: privateKey,
  }).toString("base64url");
  return `${unsignedToken}.${signature}`;
};

/** Reads useful App Store Connect error details. */
const getApiErrorDetails = (payload) => {
  // json api error guard
  if (!payload || !Array.isArray(payload.errors)) {
    return null;
  }
  const details = [];
  // collect provider error messages
  for (const error of payload.errors) {
    // readable detail guard
    if (typeof error?.detail === "string" && error.detail.trim()) {
      details.push(error.detail.trim());
    }
  }
  return details.length > 0 ? details.join("; ") : null;
};

/** Sends one authenticated App Store Connect request. */
const requestAppStoreConnect = async ({
  body,
  fetchImplementation,
  method = "GET",
  path,
  token,
}) => {
  const response = await fetchImplementation(
    `${APP_STORE_CONNECT_API_ORIGIN}${path}`,
    {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method,
    }
  );
  const responseText = await response.text();
  let payload = null;
  // response body guard
  if (responseText) {
    // parse provider response
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
  }
  // provider success guard
  if (!response.ok) {
    const details = getApiErrorDetails(payload);
    throw new Error(
      `App Store Connect ${method} ${path} failed with ${response.status}${
        details ? `: ${details}` : ""
      }`
    );
  }
  return payload;
};

/** Reads the first filtered API resource. */
const getFilteredResource = (payload, label) => {
  // collection shape guard
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error(`App Store Connect returned an invalid ${label} response`);
  }
  return payload.data[0] ?? null;
};

/** Updates one localized App Store version description. */
export const updateAppStoreDescription = async ({
  bundleId,
  createVersionIfMissing = false,
  description,
  fetchImplementation = globalThis.fetch,
  locale = "en-US",
  token,
  versionName,
}) => {
  const appQuery = new URLSearchParams({
    "filter[bundleId]": bundleId,
    limit: "1",
  });
  const appPayload = await requestAppStoreConnect({
    fetchImplementation,
    path: `/v1/apps?${appQuery}`,
    token,
  });
  const app = getFilteredResource(appPayload, "app");
  // configured app guard
  if (!app) {
    throw new Error(`No App Store Connect app found for ${bundleId}`);
  }

  const versionQuery = new URLSearchParams({
    "filter[platform]": "IOS",
    "filter[versionString]": versionName,
    limit: "10",
  });
  const versionPayload = await requestAppStoreConnect({
    fetchImplementation,
    path: `/v1/apps/${app.id}/appStoreVersions?${versionQuery}`,
    token,
  });
  let version = getFilteredResource(versionPayload, "app version");
  let createdVersion = false;
  // missing version guard
  if (!version) {
    // explicit creation guard
    if (!createVersionIfMissing) {
      throw new Error(
        `App Store version ${versionName} does not exist; create it or enable version creation`
      );
    }
    const createdVersionPayload = await requestAppStoreConnect({
      body: {
        data: {
          attributes: {
            platform: "IOS",
            versionString: versionName,
          },
          relationships: {
            app: {
              data: {
                id: app.id,
                type: "apps",
              },
            },
          },
          type: "appStoreVersions",
        },
      },
      fetchImplementation,
      method: "POST",
      path: "/v1/appStoreVersions",
      token,
    });
    version = createdVersionPayload?.data ?? null;
    createdVersion = true;
  }
  // created version guard
  if (!version?.id) {
    throw new Error(`App Store version ${versionName} has no resource ID`);
  }

  const localizationQuery = new URLSearchParams({
    "filter[locale]": locale,
    limit: "10",
  });
  const localizationPayload = await requestAppStoreConnect({
    fetchImplementation,
    path: `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?${localizationQuery}`,
    token,
  });
  const localization = getFilteredResource(
    localizationPayload,
    "app version localization"
  );
  // existing localization guard
  if (localization) {
    await requestAppStoreConnect({
      body: {
        data: {
          attributes: { description },
          id: localization.id,
          type: "appStoreVersionLocalizations",
        },
      },
      fetchImplementation,
      method: "PATCH",
      path: `/v1/appStoreVersionLocalizations/${localization.id}`,
      token,
    });
    return {
      createdLocalization: false,
      createdVersion,
      versionId: version.id,
    };
  }

  await requestAppStoreConnect({
    body: {
      data: {
        attributes: { description, locale },
        relationships: {
          appStoreVersion: {
            data: {
              id: version.id,
              type: "appStoreVersions",
            },
          },
        },
        type: "appStoreVersionLocalizations",
      },
    },
    fetchImplementation,
    method: "POST",
    path: "/v1/appStoreVersionLocalizations",
    token,
  });
  return {
    createdLocalization: true,
    createdVersion,
    versionId: version.id,
  };
};

/** Runs the metadata update from CI. */
const main = async () => {
  const bundleId = process.env.APP_STORE_BUNDLE_ID?.trim() || "fyi.ferry";
  const descriptionPath = resolve(
    process.env.APP_STORE_DESCRIPTION_PATH?.trim() ||
      "store-metadata/apple/en-US/description.txt"
  );
  const issuerId = getRequiredEnvironmentVariable(
    "APP_STORE_CONNECT_ISSUER_ID"
  );
  const keyId = getRequiredEnvironmentVariable("APP_STORE_CONNECT_API_KEY_ID");
  const locale = process.env.APP_STORE_LOCALE?.trim() || "en-US";
  const privateKeyPath = resolve(
    getRequiredEnvironmentVariable("APP_STORE_CONNECT_PRIVATE_KEY_PATH")
  );
  const versionName = getRequiredEnvironmentVariable("APP_STORE_VERSION");
  const [descriptionSource, privateKey] = await Promise.all([
    readFile(descriptionPath, "utf8"),
    readFile(privateKeyPath, "utf8"),
  ]);
  const description = descriptionSource.trim();
  // description content guard
  if (!description) {
    throw new Error(`App Store description is empty: ${descriptionPath}`);
  }
  // apple description limit guard
  if ([...description].length > APP_STORE_DESCRIPTION_LIMIT) {
    throw new Error(
      `App Store description exceeds ${APP_STORE_DESCRIPTION_LIMIT} characters`
    );
  }

  const token = createAppStoreConnectToken({
    issuerId,
    keyId,
    privateKey,
  });
  const result = await updateAppStoreDescription({
    bundleId,
    createVersionIfMissing:
      process.env.APP_STORE_CREATE_VERSION_IF_MISSING === "true",
    description,
    locale,
    token,
    versionName,
  });
  process.stdout.write(
    `Updated ${locale} App Store description for ${bundleId} ${versionName} ` +
      `(version ${result.versionId}, created version: ${result.createdVersion}, ` +
      `created localization: ${result.createdLocalization})\n`
  );
};

// direct execution guard
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    // report actionable ci failure
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
