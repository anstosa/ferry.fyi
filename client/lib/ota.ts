import { Capacitor } from "@capacitor/core";
import {
  CapacitorUpdater,
  type CapacitorUpdaterPlugin,
  type DownloadOptions,
  type LatestVersion,
} from "@capgo/capacitor-updater";
import { OtaClientEnvironment } from "shared/contracts/ota";
import { getOtaClientConfig } from "shared/lib/ota";

// narrow native updater surface
type OtaUpdater = Pick<
  CapacitorUpdaterPlugin,
  | "download"
  | "getLatest"
  | "getNextBundle"
  | "next"
  | "notifyAppReady"
  | "setUpdateUrl"
>;

export type OtaUpdateResult =
  | "disabled"
  | "failed"
  | "native-unavailable"
  | "queued"
  | "up-to-date";

// identify downloadable Capgo responses
const hasDownloadableUpdate = (
  update: LatestVersion
): update is LatestVersion & { url: string } => {
  return typeof update.url === "string" && update.url.length > 0;
};

// retain optional Capgo download metadata
const getDownloadOptions = (
  update: LatestVersion & { url: string }
): DownloadOptions => {
  const { checksum, manifest, sessionKey, url, version } = update;

  return {
    ...(checksum ? { checksum } : {}),
    ...(manifest ? { manifest } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    url,
    version,
  };
};

// configure and stage a non-disruptive update
export const initializeOtaUpdater = async ({
  environment,
  isNativePlatform = Capacitor.isNativePlatform,
  updater = CapacitorUpdater,
}: {
  environment: OtaClientEnvironment;
  isNativePlatform?: () => boolean;
  updater?: OtaUpdater;
}): Promise<OtaUpdateResult> => {
  // avoid loading a web plugin shim
  if (!isNativePlatform()) {
    return "native-unavailable";
  }

  try {
    // acknowledge the running bundle first
    await updater.notifyAppReady();
  } catch {
    // preserve the native rollback decision
    return "failed";
  }

  const config = getOtaClientConfig(environment);
  // disable unconfigured rollouts
  if (!config) {
    return "disabled";
  }

  try {
    // select the custom update manifest
    await updater.setUpdateUrl({ url: config.manifestUrl });
    const update = await updater.getLatest({ channel: config.channel });
    // retain the running bundle when current
    if (!hasDownloadableUpdate(update)) {
      return "up-to-date";
    }

    const nextBundle = await updater.getNextBundle();
    // avoid replacing an already queued update
    if (nextBundle?.version === update.version) {
      return "up-to-date";
    }

    // download before making activation possible
    const bundle = await updater.download(getDownloadOptions(update));
    // defer activation until background or restart
    await updater.next({ id: bundle.id });
    return "queued";
  } catch {
    // retain the last known-good bundle
    return "failed";
  }
};
