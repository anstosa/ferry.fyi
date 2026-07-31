// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devicePlugin = vi.hoisted(() => ({
  getInfo: vi.fn(),
}));

vi.mock("@capacitor/device", () => ({
  Device: devicePlugin,
}));

import {
  isInstalledApp,
  isInstalledToHomeScreen,
  isNativeMobileApp,
  useDevice,
} from "../../client/lib/device";

let root: Root | undefined;

const DeviceProbe = (): React.ReactElement => {
  const device = useDevice();
  return React.createElement("output", {
    "data-device": JSON.stringify(device),
  });
};

const setNativeBridge = (isNativePlatform: boolean): void => {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: {
      isNativePlatform: () => isNativePlatform,
    },
  });
};

const renderDevice = async (): Promise<HTMLOutputElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(React.createElement(DeviceProbe));
    await Promise.resolve();
  });

  const output = container.querySelector("output");
  if (!(output instanceof HTMLOutputElement)) {
    throw new Error("Device probe did not render");
  }
  return output;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  devicePlugin.getInfo.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "Capacitor");
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "standalone");
  vi.restoreAllMocks();
});

describe("device environment detection", () => {
  it("returns false when no browser window exists", () => {
    vi.stubGlobal("window", undefined);

    expect(isNativeMobileApp()).toBe(false);
    expect(isInstalledToHomeScreen()).toBe(false);
    expect(isInstalledApp()).toBe(false);
  });

  it("treats a normal browser as neither native nor installed", () => {
    setNativeBridge(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });

    expect(isNativeMobileApp()).toBe(false);
    expect(isInstalledToHomeScreen()).toBe(false);
    expect(isInstalledApp()).toBe(false);
  });

  it("recognizes a Capacitor native bridge as an installed app", () => {
    setNativeBridge(true);

    expect(isNativeMobileApp()).toBe(true);
    expect(isInstalledApp()).toBe(true);
  });
});

describe("useDevice", () => {
  it("retains the web fallback without querying the plugin in a browser", async () => {
    setNativeBridge(false);

    const output = await renderDevice();

    expect(JSON.parse(output.dataset.device ?? "null")).toMatchObject({
      isNativeMobile: false,
      operatingSystem: "unknown",
      platform: "web",
    });
    expect(devicePlugin.getInfo).not.toHaveBeenCalled();
  });

  it("replaces the fallback with native device information", async () => {
    setNativeBridge(true);
    devicePlugin.getInfo.mockResolvedValue({
      isVirtual: false,
      manufacturer: "Google",
      model: "Pixel",
      operatingSystem: "android",
      osVersion: "16",
      platform: "android",
      webViewVersion: "140",
    });

    const output = await renderDevice();

    expect(JSON.parse(output.dataset.device ?? "null")).toEqual({
      isNativeMobile: true,
      isVirtual: false,
      manufacturer: "Google",
      model: "Pixel",
      operatingSystem: "android",
      osVersion: "16",
      platform: "android",
      webViewVersion: "140",
    });
    expect(devicePlugin.getInfo).toHaveBeenCalledOnce();
  });

  it("retains the web fallback when native device inspection fails", async () => {
    setNativeBridge(true);
    devicePlugin.getInfo.mockRejectedValue(new Error("plugin unavailable"));

    const output = await renderDevice();

    expect(JSON.parse(output.dataset.device ?? "null")).toMatchObject({
      isNativeMobile: false,
      operatingSystem: "unknown",
      platform: "web",
    });
    expect(devicePlugin.getInfo).toHaveBeenCalledOnce();
  });
});
