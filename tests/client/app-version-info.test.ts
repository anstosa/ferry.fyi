// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ getInfo: vi.fn() }));
const capacitor = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
}));
const updater = vi.hoisted(() => ({ current: vi.fn() }));

vi.mock("@capacitor/app", () => ({ App: app }));
vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capgo/capacitor-updater", () => ({ CapacitorUpdater: updater }));

import {
  AppVersionInfo,
  getWebVersion,
} from "../../client/components/AppVersionInfo";
import { AppRenderProvider } from "../../client/lib/renderContext";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const renderVersionInfo = async (
  platform: "android" | "ios" | "web" = "web"
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      React.createElement(
        AppRenderProvider,
        {
          value: {
            clock: () => 0,
            hasInjectedRequest: true,
            platform,
            requestUrl: "https://ferry.fyi/about",
            runtime: "browser",
            seoBaseUrl: "https://ferry.fyi",
            seoHost: "ferry.fyi",
            seoPathname: "/about",
          },
        },
        React.createElement(AppVersionInfo)
      )
    );
    await Promise.resolve();
  });

  return container;
};

describe("getWebVersion", () => {
  it("uses DEVELOPMENT for local browser builds", () => {
    expect(
      getWebVersion({
        HEROKU_RELEASE_VERSION: "production-hash",
        NODE_ENV: "development",
      })
    ).toBe("DEVELOPMENT");
  });

  it("uses the deployed release hash for production browser builds", () => {
    expect(
      getWebVersion({
        HEROKU_RELEASE_VERSION: "0123456789abcdef0123456789abcdef01234567",
        NODE_ENV: "production",
      })
    ).toBe("01234567");
  });

  // preserve non-hash labels
  it("keeps non-hash production version labels intact", () => {
    expect(
      getWebVersion({
        HEROKU_RELEASE_VERSION: "production-release",
        NODE_ENV: "production",
      })
    ).toBe("production-release");
  });

  it("prefers the release injected by the running production server", () => {
    const document = window.document.implementation.createHTMLDocument();
    document.head.innerHTML =
      '<meta name="ferry-fyi-release" content="fedcba9876543210fedcba9876543210fedcba98" />';

    expect(
      getWebVersion(
        { HEROKU_RELEASE_VERSION: "build-hash", NODE_ENV: "production" },
        document
      )
    ).toBe("fedcba98");
  });

  // verify build-inlined defaults
  it("reads build-inlined production values without an environment argument", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "HEROKU_RELEASE_VERSION",
      "0123456789abcdef0123456789abcdef01234567"
    );
    document.head.innerHTML =
      '<meta name="ferry-fyi-release" content="fedcba9876543210fedcba9876543210fedcba98" />';

    expect(getWebVersion()).toBe("fedcba98");
  });
});

describe("AppVersionInfo", () => {
  it("shows the web version without querying native plugins", async () => {
    const container = await renderVersionInfo();

    expect(container.textContent).toBe("DEVELOPMENT");
    expect(app.getInfo).not.toHaveBeenCalled();
    expect(updater.current).not.toHaveBeenCalled();
  });

  it("shows the Android build and OTA revision on one line", async () => {
    vi.stubEnv("NODE_ENV", "production");
    document.head.innerHTML =
      '<meta name="ferry-fyi-release" content="abcdef0123456789abcdef0123456789abcdef01" />';
    app.getInfo.mockResolvedValue({ build: "262012119", version: "3.0" });
    updater.current.mockResolvedValue({
      bundle: { id: "ota-bundle", version: "3.0.1" },
    });
    const container = await renderVersionInfo("android");

    expect(container.textContent).toBe(
      "Android 3.0 (262012119) · OTA abcdef01"
    );
    expect(
      container.querySelector("button")?.classList.contains("whitespace-nowrap")
    ).toBe(true);
  });

  it("uses the iOS label with its canonical build version", async () => {
    app.getInfo.mockResolvedValue({ build: "263", version: "3.0" });
    updater.current.mockResolvedValue({ bundle: { id: "builtin" } });

    const container = await renderVersionInfo("ios");

    expect(container.textContent).toBe("iOS 3.0 (263) · OTA Built-in");
  });

  it("copies the complete version string and briefly confirms success", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    app.getInfo.mockResolvedValue({ build: "262150814", version: "3.3" });
    updater.current.mockResolvedValue({ bundle: { id: "builtin" } });
    const container = await renderVersionInfo("android");
    const button = container.querySelector("button");

    await act(async () => button?.click());

    expect(writeText).toHaveBeenCalledWith(
      "Android 3.3 (262150814) · OTA Built-in"
    );
    expect(container.textContent).toContain("Copied to clipboard!");
    expect(button?.classList.contains("bg-green-100")).toBe(true);

    await act(async () => vi.advanceTimersByTime(2_000));

    expect(container.textContent).not.toContain("Copied to clipboard!");
    expect(button?.classList.contains("bg-green-100")).toBe(false);
  });
});
