import React, { FunctionComponent, useEffect, useRef, useState } from "react";

import { useAppRenderContext } from "~/lib/renderContext";

interface Versions {
  app?: string;
  ota?: string;
}

const COPIED_FEEDBACK_MS = 2_000;

// keep local browser builds distinct from deployed web releases
export const getWebVersion = (
  environment: Record<string, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
    HEROKU_RELEASE_VERSION: process.env.HEROKU_RELEASE_VERSION,
  },
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
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const { platform, runtime } = useAppRenderContext();
  const isNative = platform === "android" || platform === "ios";

  useEffect(() => {
    if (!isNative || runtime !== "browser") {
      return;
    }
    let isMounted = true;

    import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then(({ build, version }) => {
        if (isMounted) {
          setVersions((current) => ({
            ...current,
            app: `${getNativePlatformLabel(platform)} ${version} (${build})`,
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

  useEffect(
    () => () => {
      clearTimeout(copiedTimeoutRef.current);
    },
    []
  );

  const versionText = isNative
    ? [versions.app, versions.ota && `OTA ${versions.ota}`]
        .filter(Boolean)
        .join(" · ")
    : (() => {
        const webVersion = getWebVersion();
        return webVersion === "DEVELOPMENT" ? webVersion : `Web ${webVersion}`;
      })();

  if (!versionText) {
    return null;
  }

  const copyVersion = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(versionText);
      clearTimeout(copiedTimeoutRef.current);
      setCopied(true);
      copiedTimeoutRef.current = setTimeout(
        () => setCopied(false),
        COPIED_FEEDBACK_MS
      );
    } catch {
      // Clipboard access is best-effort and must not disrupt the About page.
    }
  };

  return (
    <div className="mt-12 text-center font-mono text-xs text-gray-500 dark:text-gray-400">
      <span className="relative inline-flex flex-col items-center">
        <span
          aria-live="polite"
          className={`absolute bottom-full mb-1 whitespace-nowrap font-sans font-semibold text-green-700 transition-opacity dark:text-green-300 ${
            copied ? "opacity-100" : "opacity-0"
          }`}
        >
          {copied ? "Copied to clipboard!" : ""}
        </span>
        <button
          aria-label="Copy version information"
          className={`rounded px-2 py-1 font-mono whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${
            copied ? "bg-green-100 dark:bg-green-900/60" : "bg-transparent"
          }`}
          onClick={() => copyVersion().catch(() => undefined)}
          type="button"
        >
          {versionText}
        </button>
      </span>
    </div>
  );
};
