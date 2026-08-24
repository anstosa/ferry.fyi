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
  // reject test billing in production
  it("refuses a sandbox public key in a production client", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REVENUECAT_WEB_PUBLIC_API_KEY", "rcb_sb_test-key");
    const { loadWebSupporterProducts } = await import(
      "../../client/lib/supporterWeb"
    );

    await expect(loadWebSupporterProducts("customer-1")).rejects.toThrow(
      "Web subscriptions are not configured for production"
    );
    expect(purchases.configure).not.toHaveBeenCalled();
  });

  // reject native keys on web
  it("refuses a non-billing public key in a production client", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REVENUECAT_WEB_PUBLIC_API_KEY", "appl_test-key");
    const { loadWebSupporterProducts } = await import(
      "../../client/lib/supporterWeb"
    );

    await expect(loadWebSupporterProducts("customer-1")).rejects.toThrow(
      "Web subscriptions are not configured for production"
    );
    expect(purchases.configure).not.toHaveBeenCalled();
  });
});
