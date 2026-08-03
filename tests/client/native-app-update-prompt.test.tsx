// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  checkForNativeAppUpdate: vi.fn(),
  openNativeAppStore: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: mocks.addListener },
}));
vi.mock("~/lib/nativeAppUpdate", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../client/lib/nativeAppUpdate")
  >()),
  checkForNativeAppUpdate: mocks.checkForNativeAppUpdate,
  openNativeAppStore: mocks.openNativeAppStore,
}));
vi.mock("framer-motion", () => ({
  motion: { div: "div" },
}));

import { NativeAppUpdatePrompt } from "../../client/components/NativeAppUpdatePrompt";
import {
  type AppRenderContextValue,
  AppRenderProvider,
} from "../../client/lib/renderContext";

let root: Root | undefined;

const renderPrompt = async (
  platform: AppRenderContextValue["platform"]
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <AppRenderProvider
        value={{
          clock: () => 0,
          hasInjectedRequest: true,
          platform,
          requestUrl: "https://ferry.fyi/",
          runtime: "browser",
          seoBaseUrl: "https://ferry.fyi",
          seoHost: "ferry.fyi",
          seoPathname: "/",
        }}
      >
        <NativeAppUpdatePrompt />
      </AppRenderProvider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.addListener.mockResolvedValue({ remove: mocks.remove });
  mocks.openNativeAppStore.mockResolvedValue(undefined);
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await Promise.resolve();
  });
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("NativeAppUpdatePrompt", () => {
  it("does not load native update hooks on the web", async () => {
    const container = await renderPrompt("web");

    expect(container.textContent).toBe("");
    expect(mocks.checkForNativeAppUpdate).not.toHaveBeenCalled();
    expect(mocks.addListener).not.toHaveBeenCalled();
  });

  it("prompts for an Android update and opens Google Play", async () => {
    mocks.checkForNativeAppUpdate.mockResolvedValue({
      availableVersion: "21",
      currentVersion: "20",
      platform: "android",
      versionKey: "android:21",
    });
    const container = await renderPrompt("android");

    expect(container.textContent).toContain("Update Ferry FYI");
    expect(container.textContent).toContain("Google Play");
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "Open Google Play"
    );
    expect(button).toBeDefined();

    await act(async () => button?.click());

    expect(mocks.openNativeAppStore).toHaveBeenCalledWith({
      platform: "android",
    });
    expect(container.textContent).not.toContain("Update Ferry FYI");
  });

  it("keeps the prompt available when opening the store fails", async () => {
    mocks.checkForNativeAppUpdate.mockResolvedValue({
      availableVersion: "21",
      currentVersion: "20",
      platform: "android",
      versionKey: "android:21",
    });
    mocks.openNativeAppStore.mockRejectedValue(new Error("store unavailable"));
    const container = await renderPrompt("android");
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "Open Google Play"
    );

    await act(async () => button?.click());

    expect(container.textContent).toContain("Update Ferry FYI");
    expect(window.localStorage.getItem("nativeAppUpdateDismissal")).toBeNull();
  });

  it("honors a recent dismissal for the same store version", async () => {
    window.localStorage.setItem(
      "nativeAppUpdateDismissal",
      JSON.stringify({ dismissedAt: Date.now(), versionKey: "ios:2.9" })
    );
    mocks.checkForNativeAppUpdate.mockResolvedValue({
      availableVersion: "2.9",
      currentVersion: "2.8",
      platform: "ios",
      versionKey: "ios:2.9",
    });

    const container = await renderPrompt("ios");

    expect(container.textContent).not.toContain("Update Ferry FYI");
  });

  it("checks again on every active transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    mocks.checkForNativeAppUpdate.mockResolvedValue(null);
    await renderPrompt("ios");
    const listener = mocks.addListener.mock.calls.find(
      ([eventName]) => eventName === "appStateChange"
    )?.[1] as ((state: { isActive: boolean }) => void) | undefined;
    expect(listener).toBeDefined();
    expect(mocks.checkForNativeAppUpdate).toHaveBeenCalledOnce();

    await act(async () => {
      listener?.({ isActive: true });
      await Promise.resolve();
    });

    expect(mocks.checkForNativeAppUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.checkForNativeAppUpdate).toHaveBeenLastCalledWith({
      platform: "ios",
    });
    vi.useRealTimers();
  });
});
