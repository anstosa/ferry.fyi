import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");

const clientEnvKeys = [
  "AUTH0_CLIENT_AUDIENCE",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_REDIRECT",
  "AUTH0_DEV_POPUP_REDIRECT",
  "AUTH0_DOMAIN",
  "BASE_URL",
  "FIREBASE_API_KEY",
  "FIREBASE_APP_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_SENDER_ID",
  "FIREBASE_VAPID_KEY",
  "GOOGLE_ANALYTICS",
  "GTM_CONTAINER_ID",
  "HEROKU_RELEASE_VERSION",
  "LOG_LEVEL",
  "MAPBOX_ACCESS_TOKEN",
  "NODE_ENV",
  "SENTRY_DSN",
  "VITE_OTA_CHANNEL",
  "VITE_OTA_MANIFEST_URL",
] as const;

export const clientViteAliases = {
  "~": configDir,
  lib: path.resolve(configDir, "lib"),
  shared: path.resolve(repoRoot, "shared"),
};

/** Only browser-safe build values are inlined into either browser or SSR code. */
export const clientBuildEnvDefines = (): Record<string, string> => {
  const defines: Record<string, string> = {};
  for (const key of clientEnvKeys) {
    const value =
      process.env[key] ??
      (key === "HEROKU_RELEASE_VERSION" ? "DEVELOPMENT" : undefined);
    defines[`process.env.${key}`] = JSON.stringify(value);
  }
  return defines;
};
