import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import React, { FunctionComponent, useEffect, useState } from "react";

interface Versions {
  app?: string;
  ota?: string;
}

// Keep local browser builds distinct from deployed web releases.
export const getWebVersion = (
  environment: Record<string, string | undefined> = process.env
): string => {
  if (environment.NODE_ENV === "development") {
    return "DEVELOPMENT";
  }
  return environment.HEROKU_RELEASE_VERSION ?? "DEVELOPMENT";
};

// Show native build and active bundle versions for support requests.
export const AppVersionInfo: FunctionComponent = () => {
  const [versions, setVersions] = useState<Versions>({});
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) {
      return;
    }
    let isMounted = true;

    App.getInfo()
      .then(({ build, version }) => {
        if (isMounted) {
          setVersions((current) => ({
            ...current,
            app: `${version} (${build})`,
          }));
        }
      })
      .catch(() => undefined);

    CapacitorUpdater.current()
      .then(({ bundle }) => {
        if (isMounted) {
          setVersions((current) => ({ ...current, ota: bundle.version }));
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [isNative]);

  if (!isNative) {
    const webVersion = getWebVersion();
    return (
      <div className="mt-12 text-center font-mono text-xs text-gray-500 dark:text-gray-400">
        {webVersion === "DEVELOPMENT" ? webVersion : `Web ${webVersion}`}
      </div>
    );
  }

  if (!versions.app && !versions.ota) {
    return null;
  }

  return (
    <div className="mt-12 text-center font-mono text-xs text-gray-500 dark:text-gray-400">
      {versions.app && <div>App {versions.app}</div>}
      {versions.ota && <div>OTA {versions.ota}</div>}
    </div>
  );
};
