import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revenueCat = vi.hoisted(() => {
  const syntheticThen = vi.fn(() => {
    throw new Error('"Purchases.then()" is not implemented on android');
  });
  const plugin = {
    configure: vi.fn().mockResolvedValue(undefined),
    getCustomerInfo: vi.fn().mockResolvedValue({
      customerInfo: {
        managementURL:
          "https://play.google.com/store/account/subscriptions?package=fyi.ferry",
      },
    }),
  };
  const proxy = new Proxy(plugin, {
    // reproduce capacitor's dynamic plugin method lookup
    get(target, property, receiver) {
      // expose the synthetic method that breaks async returns
      if (property === "then") {
        return syntheticThen;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { plugin, proxy, syntheticThen };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
}));
vi.mock("@revenuecat/purchases-capacitor", () => ({
  ENTITLEMENT_VERIFICATION_MODE: { INFORMATIONAL: "INFORMATIONAL" },
  Purchases: revenueCat.proxy,
}));

import { getNativeSupporterManagementUrl } from "../../client/lib/supporterNative";

beforeEach(() => {
  vi.stubEnv("REVENUECAT_ANDROID_PUBLIC_API_KEY", "goog_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("native supporter management", () => {
  // prevent revenuecat proxy promise assimilation
  it("resolves management without invoking a synthetic then method", async () => {
    await expect(
      getNativeSupporterManagementUrl("customer-1")
    ).resolves.toBe(
      "https://play.google.com/store/account/subscriptions?package=fyi.ferry"
    );
    expect(revenueCat.plugin.configure).toHaveBeenCalledWith(
      expect.objectContaining({ appUserID: "customer-1" })
    );
    expect(revenueCat.plugin.getCustomerInfo).toHaveBeenCalledOnce();
    expect(revenueCat.syntheticThen).not.toHaveBeenCalled();
  });
});
