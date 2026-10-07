// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "web" as "android" | "ios" | "web",
  trackProductEvent: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("~/components/Page", () => ({
  Page: ({ children }: React.PropsWithChildren) =>
    React.createElement("main", null, children),
}));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/components/Toast", () => ({
  Toast: ({ children }: React.PropsWithChildren) =>
    React.createElement("aside", null, children),
}));
vi.mock("~/lib/analytics", () => ({
  trackProductEvent: mocks.trackProductEvent,
}));
vi.mock("~/lib/appInstall", () => ({
  APPLE_APP_STORE_URL: "https://apps.example/ferry",
  GOOGLE_PLAY_URL: "https://play.example/ferry",
  getBrowserInstallPlatform: () => mocks.platform,
  subscribeInstallPromptRequests: () => mocks.unsubscribe,
}));
vi.mock("~/lib/browser", () => ({
  useLocalStorage: (key: string) =>
    key === "installPromptLoadCount"
      ? ([3, vi.fn()] as const)
      : ([false, vi.fn()] as const),
}));
vi.mock("~/lib/device", () => ({ isInstalledApp: () => false }));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ automaticLeaderboardCheckinsEnabled: false }),
}));
vi.mock("~/lib/installPrompt", () => ({
  hasInstallPrompt: () => false,
  subscribeInstallPrompt: () => mocks.unsubscribe,
  triggerInstallPrompt: vi.fn(),
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

import { AppTeaser } from "../../client/components/AppTeaser";
import { InstallPromptToast } from "../../client/components/InstallPromptToast";
import { InstallPublicContent } from "../../client/views/InstallPublicContent";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  mocks.platform = "web";
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// render one install promotion
const renderPromotion = (element: React.ReactElement): HTMLDivElement => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
};

// click one external store link without navigation
const clickStoreLink = (container: HTMLElement, href: string): void => {
  const link = container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  // required fixture link
  if (!link) {
    throw new Error(`Missing store link ${href}`);
  }
  link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("install store analytics", () => {
  // public cards expose fixed store enums
  it("classifies both public install cards without sending their URLs", () => {
    const container = renderPromotion(<InstallPublicContent />);

    clickStoreLink(container, "https://apps.example/ferry");
    clickStoreLink(container, "https://play.example/ferry");

    expect(mocks.trackProductEvent.mock.calls).toEqual([
      ["install_store_opened", { store: "apple" }],
      ["install_store_opened", { store: "google" }],
    ]);
  });

  // app teasers expose fixed store enums
  it.each([
    ["android", "https://play.example/ferry", "google"],
    ["ios", "https://apps.example/ferry", "apple"],
  ] as const)("classifies the %s app teaser", (platform, href, store) => {
    mocks.platform = platform;
    const container = renderPromotion(<AppTeaser />);

    clickStoreLink(container, href);

    expect(mocks.trackProductEvent).toHaveBeenCalledWith(
      "install_store_opened",
      { store }
    );
  });

  // prompt actions expose fixed store enums
  it.each([
    ["android", "https://play.example/ferry", "google"],
    ["ios", "https://apps.example/ferry", "apple"],
  ] as const)(
    "classifies the %s prompt-toast store action",
    (platform, href, store) => {
      mocks.platform = platform;
      const container = renderPromotion(<InstallPromptToast />);

      clickStoreLink(container, href);

      expect(mocks.trackProductEvent).toHaveBeenCalledWith(
        "install_store_opened",
        { store }
      );
    }
  );
});
