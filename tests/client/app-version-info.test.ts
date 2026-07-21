// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ getInfo: vi.fn() }));
const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));
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
  vi.clearAllMocks();
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
});

describe("AppVersionInfo", () => {
  it("shows the web version without querying native plugins", async () => {
    capacitor.isNativePlatform.mockReturnValue(false);

    const container = await renderVersionInfo();

    expect(container.textContent).toBe("DEVELOPMENT");
    expect(app.getInfo).not.toHaveBeenCalled();
    expect(updater.current).not.toHaveBeenCalled();
  });

  it("shows the installed app and active OTA bundle versions", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    app.getInfo.mockResolvedValue({ build: "262012119", version: "3.0" });
    updater.current.mockResolvedValue({ bundle: { version: "3.0.1" } });

    const container = await renderVersionInfo();

    expect(container.textContent).toContain("App 3.0 (262012119)");
    expect(container.textContent).toContain("OTA 3.0.1");
  });
});
