import { beforeEach, describe, expect, it, vi } from "vitest";

// create mutable sdk state
const purchases = vi.hoisted(() => ({
  configure: vi.fn(),
}));

// isolate the external billing sdk
vi.mock("@revenuecat/purchases-js", () => ({
  Purchases: { configure: purchases.configure },
}));

// reset sdk ownership
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  purchases.configure.mockReset();
});

describe("RevenueCat web environment", () => {
  // reject non-production billing keys
  it.each(["rcb_sb_test-key", "appl_test-key"])(
    "refuses %s in a production client",
    async (key) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REVENUECAT_WEB_PUBLIC_API_KEY", key);
      const { loadWebSupporterProducts } =
        await import("../../client/lib/supporterWeb");

      await expect(loadWebSupporterProducts("customer-1")).rejects.toThrow(
        "Web subscriptions are not configured for production"
      );
      expect(purchases.configure).not.toHaveBeenCalled();
    }
  );
});
