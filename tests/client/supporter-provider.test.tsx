// @vitest-environment jsdom

import React, { act, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SupporterStatus } from "shared/contracts/supporter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));
const userActions = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  refreshUser: vi.fn(),
}));
const userState = vi.hoisted(() => ({
  isAuthenticated: true,
  user: {
    supporter: { adsEnabled: false, revision: "v1:0:1" },
    user_id: "auth0|supporter-rider",
  },
}));
const web = vi.hoisted(() => ({
  loadProducts: vi.fn(),
  openManagement: vi.fn(),
  purchase: vi.fn(),
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "web",
    isNativePlatform: () => false,
  },
}));
vi.mock("~/lib/api", () => api);
vi.mock("~/lib/user", () => ({
  useUser: () => [userState, userActions],
}));
vi.mock("~/lib/supporterNative", () => ({
  getNativeSupporterManagementUrl: vi.fn(),
  hasNativeSupporterCapability: () => false,
  loadNativeSupporterProducts: vi.fn(),
  purchaseNativeSupporter: vi.fn(),
  restoreNativeSupporter: vi.fn(),
}));
vi.mock("~/lib/supporterWeb", () => ({
  loadWebSupporterProducts: web.loadProducts,
  openWebSupporterManagement: web.openManagement,
  purchaseWebSupporter: web.purchase,
}));

import { useSupporter } from "../../client/lib/supporterContext";
import { SupporterProvider } from "../../client/lib/supporterProvider";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

// build one complete provider response
const makeSupporterStatus = (
  adsEnabled: boolean,
  revision: string
): SupporterStatus => ({
  active: true,
  activeUntil: null,
  adsEnabled,
  appUserId: "customer-1",
  checkoutAvailability: { android: true, ios: true, web: true },
  degradedCode: null,
  lastReconciledAt: null,
  lastVerifiedAt: null,
  lifecycleState: "active",
  resolved: true,
  revision,
  sources: [],
  supporterBadgeVisible: false,
});

/** Starts the same child-owned refresh used by the checkout card. */
const SupporterHarness = (): ReactElement => {
  const supporter = useSupporter();
  let label = "idle";
  // expose provider failure
  if (supporter.error) {
    label = supporter.error;
  } else if (supporter.isLoading) {
    // expose loading state
    label = "loading";
  } else if (supporter.status?.resolved) {
    // expose resolved state
    label = supporter.status.adsEnabled ? "ready:ads-on" : "ready:ads-off";
  }
  // start checkout loading after provider ownership settles
  useEffect(() => {
    supporter.refresh().catch(() => undefined);
  }, [supporter.refresh]);
  // expose management action
  const manage = (): void => {
    supporter.manage().catch(() => undefined);
  };
  // expose the supporter ad preference action
  const showAds = (): void => {
    supporter.setAdsEnabled(true).catch(() => undefined);
  };
  // expose the inverse supporter ad preference action
  const hideAds = (): void => {
    supporter.setAdsEnabled(false).catch(() => undefined);
  };
  return (
    <div>
      <span>{label}</span>
      <button aria-label="Manage" onClick={manage} type="button" />
      <button aria-label="Show ads" onClick={showAds} type="button" />
      <button aria-label="Hide ads" onClick={hideAds} type="button" />
    </div>
  );
};

// render one provider and checkout consumer
const renderProvider = async (): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <SupporterProvider>
        <SupporterHarness />
      </SupporterProvider>
    );
    await Promise.resolve();
  });
  return container;
};

beforeEach(() => {
  userActions.getAccessToken.mockReset().mockResolvedValue("access-token");
  userActions.refreshUser.mockReset().mockResolvedValue(undefined);
  web.loadProducts.mockReset().mockResolvedValue([]);
  web.openManagement.mockReset().mockResolvedValue(undefined);
  web.purchase.mockReset().mockResolvedValue("cancelled");
  api.get.mockReset().mockResolvedValue(makeSupporterStatus(false, "v1:1:1"));
  api.put.mockReset().mockResolvedValue(makeSupporterStatus(true, "v1:2:1"));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SupporterProvider", () => {
  // keep initial account ownership from invalidating checkout refresh
  it("settles the first supporter refresh instead of loading forever", async () => {
    const container = await renderProvider();

    await vi.waitFor(() => expect(container.textContent).toContain("ready"));
    expect(api.get).toHaveBeenCalledWith("/supporter", "access-token");
    expect(userActions.refreshUser).toHaveBeenCalledWith("access-token");
  });

  // bound an external request that never settles
  it("replaces a stalled load with retryable guidance", async () => {
    vi.useFakeTimers();
    userActions.getAccessToken.mockReturnValue(new Promise(() => undefined));
    const container = await renderProvider();

    expect(container.textContent).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(container.textContent).toBe(
      "Supporter plans took too long to load. Try again."
    );
  });

  // use the sdk-provided web portal
  it("opens web management without requesting a server token", async () => {
    const container = await renderProvider();

    await vi.waitFor(() => expect(container.textContent).toContain("ready"));
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(web.openManagement).toHaveBeenCalledWith("customer-1");
    expect(api.post).not.toHaveBeenCalled();
  });

  // expose both persisted ad preference states
  it("updates the active supporter's advertisement preference", async () => {
    const container = await renderProvider();

    await vi.waitFor(() =>
      expect(container.textContent).toContain("ready:ads-off")
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Show ads"]')
        ?.click();
      await Promise.resolve();
    });

    expect(api.put).toHaveBeenCalledWith(
      "/supporter/preferences",
      { adsEnabled: true },
      "access-token"
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("ready:ads-on")
    );

    api.put.mockResolvedValueOnce(makeSupporterStatus(false, "v1:3:1"));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Hide ads"]')
        ?.click();
      await Promise.resolve();
    });
    expect(api.put).toHaveBeenLastCalledWith(
      "/supporter/preferences",
      { adsEnabled: false },
      "access-token"
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("ready:ads-off")
    );
  });
});
