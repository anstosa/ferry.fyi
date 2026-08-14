// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasInstallPrompt: vi.fn(() => false),
  installed: false,
  platform: "web" as "android" | "ios" | "web",
  redirectToInstallStore: vi.fn(() => false),
  subscribeInstallPrompt: vi.fn(() => vi.fn()),
  triggerInstallPrompt: vi.fn(async () => false),
}));

vi.mock("~/components/Page", () => ({
  Page: ({ children }: React.PropsWithChildren) =>
    React.createElement("main", null, children),
}));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/lib/appInstall", () => ({
  getBrowserInstallPlatform: () => mocks.platform,
  getInstallStoreUrl: (platform: string) => {
    // deterministic store doubles
    const storeUrls: Record<string, string> = {
      android: "https://play.example/app",
      ios: "https://apps.example/app",
    };
    return storeUrls[platform] ?? null;
  },
  redirectToInstallStore: mocks.redirectToInstallStore,
}));
vi.mock("~/lib/device", () => ({
  isInstalledApp: () => mocks.installed,
}));
vi.mock("~/lib/installPrompt", () => ({
  hasInstallPrompt: mocks.hasInstallPrompt,
  subscribeInstallPrompt: mocks.subscribeInstallPrompt,
  triggerInstallPrompt: mocks.triggerInstallPrompt,
}));
vi.mock("~/static/images/icons/brands/app-store-ios.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/brands/google-play.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/download.svg", () => ({
  default: () => null,
}));

import { Install } from "../../client/views/Install";

describe("Install page", () => {
  let root: Root | undefined;

  beforeEach(() => {
    mocks.installed = false;
    mocks.platform = "web";
    mocks.redirectToInstallStore.mockReturnValue(false);
    mocks.triggerInstallPrompt.mockResolvedValue(false);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  // render the install route and settle its automatic effect
  const renderInstall = async (): Promise<HTMLDivElement> => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(Install));
      await Promise.resolve();
    });
    return container;
  };

  it("redirects Android browsers to their store", async () => {
    mocks.platform = "android";
    mocks.redirectToInstallStore.mockReturnValue(true);

    const container = await renderInstall();

    expect(mocks.redirectToInstallStore).toHaveBeenCalledWith("android");
    expect(mocks.triggerInstallPrompt).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening Google Play");
  });

  it("requests the PWA install prompt automatically on desktop", async () => {
    mocks.triggerInstallPrompt.mockResolvedValue(true);

    const container = await renderInstall();

    expect(mocks.redirectToInstallStore).toHaveBeenCalledWith("web");
    expect(mocks.triggerInstallPrompt).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("installation request was opened");
  });

  it("offers a manual retry when the automatic desktop prompt is unavailable", async () => {
    const container = await renderInstall();
    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "Install Ferry FYI"
    );

    expect(container.textContent).toContain("did not open");
    await act(async () => button?.click());
    expect(mocks.triggerInstallPrompt).toHaveBeenCalledTimes(2);
  });
});
