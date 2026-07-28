// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const renderVersionInfo = async (): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(React.createElement(AppVersionInfo));
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
        HEROKU_RELEASE_VERSION: "production-hash",
        NODE_ENV: "production",
      })
    ).toBe("production-hash");
  });

  it("prefers the release injected by the running production server", () => {
    const document = window.document.implementation.createHTMLDocument();
    document.head.innerHTML =
      '<meta name="ferry-fyi-release" content="runtime-hash" />';

    expect(
      getWebVersion(
        { HEROKU_RELEASE_VERSION: "build-hash", NODE_ENV: "production" },
        document
      )
    ).toBe("runtime-hash");
  });
});

describe("AppVersionInfo", () => {
  it("shows the web version without querying native plugins", async () => {
    capacitor.isNativePlatform.mockReturnValue(false);

    const container = await renderVersionInfo();

    expect(container.textContent).toBe("DEVELOPMENT");
    expect(app.getInfo).not.toHaveBeenCalled();
    expect(updater.current).not.toHaveBeenCalled();
  });

  it("shows the Android build and OTA revision on one line", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    capacitor.getPlatform.mockReturnValue("android");
    vi.stubEnv("NODE_ENV", "production");
    document.head.innerHTML =
      '<meta name="ferry-fyi-release" content="web-build-hash" />';
    app.getInfo.mockResolvedValue({ build: "262012119", version: "3.0" });
    updater.current.mockResolvedValue({
      bundle: { id: "ota-bundle", version: "3.0.1" },
    });
    const container = await renderVersionInfo();

    expect(container.textContent).toBe(
      "Android 262012119 · OTA web-build-hash"
    );
    expect(
      container.firstElementChild?.classList.contains("whitespace-nowrap")
    ).toBe(true);
  });

  it("uses the iOS label with its canonical build version", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    capacitor.getPlatform.mockReturnValue("ios");
    app.getInfo.mockResolvedValue({ build: "263", version: "3.0" });
    updater.current.mockResolvedValue({ bundle: { id: "builtin" } });

    const container = await renderVersionInfo();

    expect(container.textContent).toBe("iOS 263 · OTA Built-in");
  });
});
