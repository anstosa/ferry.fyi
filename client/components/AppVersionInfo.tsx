import React, { FunctionComponent, useEffect, useState } from "react";

import { useAppRenderContext } from "~/lib/renderContext";

interface Versions {
  app?: string;
  ota?: string;
}

// Keep local browser builds distinct from deployed web releases.
export const getWebVersion = (
  environment: Record<string, string | undefined> = process.env,
  document: Document | undefined = globalThis.document
): string => {
  if (environment.NODE_ENV !== "production") {
    return "DEVELOPMENT";
  }
  const runtimeVersion = document
    ?.querySelector<HTMLMetaElement>('meta[name="ferry-fyi-release"]')
    ?.content.trim();
  return runtimeVersion || environment.HEROKU_RELEASE_VERSION || "UNKNOWN";
};

export const getNativePlatformLabel = (platform: string): string => {
  return platform === "ios" ? "iOS" : "Android";
};

// Show native builds and active OTA source revisions for support requests.
export const AppVersionInfo: FunctionComponent = () => {
  const [versions, setVersions] = useState<Versions>({});
  const { platform, runtime } = useAppRenderContext();
  const isNative = platform === "android" || platform === "ios";

  useEffect(() => {
    if (!isNative || runtime !== "browser") {
      return;
    }
    let isMounted = true;

    import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then(({ build }) => {
        if (isMounted) {
          setVersions((current) => ({
            ...current,
            app: `${getNativePlatformLabel(platform)} ${build}`,
          }));
        }
      })
      .catch(() => undefined);

    import("@capgo/capacitor-updater")
      .then(({ CapacitorUpdater }) => CapacitorUpdater.current())
      .then(({ bundle }) => {
        if (isMounted) {
          setVersions((current) => ({
            ...current,
            ota: bundle.id === "builtin" ? "Built-in" : getWebVersion(),
          }));
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [isNative, platform, runtime]);

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
    <div className="mt-12 text-center font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
      {versions.app}
      {versions.app && versions.ota && " · "}
      {versions.ota && `OTA ${versions.ota}`}
    </div>
  );
};
