import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
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
  | "addListener"
  | "download"
  | "getLatest"
  | "getNextBundle"
  | "next"
  | "notifyAppReady"
  | "reload"
  | "setUpdateUrl"
>;

export type OtaUpdateResult =
  | "disabled"
  | "failed"
  | "native-unavailable"
  | "queued"
  | "up-to-date";

export type OtaUpdateState =
  | { status: "idle" }
  | { status: "downloading"; progress: number }
  | { status: "ready"; bundleId: string }
  | { status: "failed" };

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
  onStateChange,
  updater = CapacitorUpdater,
}: {
  environment: OtaClientEnvironment;
  isNativePlatform?: () => boolean;
  onStateChange?: (state: OtaUpdateState) => void;
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
    console.warn(
      "OTA readiness acknowledgement failed; retaining native rollback protection"
    );
    // preserve the native rollback decision
    return "failed";
  }

  const config = getOtaClientConfig(environment);
  // disable unconfigured rollouts
  if (!config) {
    return "disabled";
  }

  let downloadListener: PluginListenerHandle | undefined;
  let updateAvailable = false;
  let listening = false;
  try {
    // select the custom update manifest
    await updater.setUpdateUrl({ url: config.manifestUrl });
    const update = await updater.getLatest({ channel: config.channel });
    // retain the running bundle when current
    if (!hasDownloadableUpdate(update)) {
      return "up-to-date";
    }

    updateAvailable = true;
    const nextBundle = await updater.getNextBundle();
    // reuse only a pending bundle still offered by the configured channel
    if (
      nextBundle &&
      nextBundle.id !== "builtin" &&
      nextBundle.status === "pending" &&
      nextBundle.version === update.version
    ) {
      onStateChange?.({ status: "ready", bundleId: nextBundle.id });
      return "queued";
    }

    listening = true;
    onStateChange?.({ status: "downloading", progress: 0 });
    // subscribe before starting the native transfer
    downloadListener = await updater.addListener("download", (event) => {
      // ignore retired transfers and malformed progress
      if (
        !listening ||
        event.bundle.version !== update.version ||
        !Number.isFinite(event.percent)
      ) {
        return;
      }
      onStateChange?.({
        status: "downloading",
        progress: Math.min(100, Math.max(0, Math.round(event.percent))),
      });
    });

    // download before making activation possible
    const bundle = await updater.download(getDownloadOptions(update));
    // defer activation until background or restart
    await updater.next({ id: bundle.id });
    onStateChange?.({ status: "ready", bundleId: bundle.id });
    return "queued";
  } catch {
    // surface known download failures without inventing an available update
    if (updateAvailable) {
      onStateChange?.({ status: "failed" });
    }
    // retain the last known-good bundle
    return "failed";
  } finally {
    // prevent delayed native events from replacing ready or failed state
    listening = false;
    // release only this download's listener
    await downloadListener?.remove().catch(() => undefined);
  }
};

// native reload applies and clears the queued bundle before restarting the webview
export const applyOtaUpdate = async (
  updater: Pick<OtaUpdater, "reload"> = CapacitorUpdater
): Promise<void> => {
  await updater.reload();
};
