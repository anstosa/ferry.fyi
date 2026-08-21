// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reactGa = vi.hoisted(() => ({
  event: vi.fn(),
  initialize: vi.fn(),
  send: vi.fn(),
  set: vi.fn(),
}));

vi.mock("react-ga4", () => ({ default: reactGa }));

// normalize gtag arguments-object commands
const dataLayerCommands = (): unknown[][] =>
  (window.dataLayer ?? [])
    .filter((value): value is IArguments => "length" in value)
    .map((value) => Array.from(value));

describe("analytics advertising privacy", () => {
  // isolate deferred analytics module state
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_ANALYTICS", "G-PRIVACY-TEST");
    vi.stubEnv("GTM_CONTAINER_ID", "");
    delete window.dataLayer;
  });

  // restore browser and environment state
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.dataLayer;
  });

  // deny advertising data use before analytics activates
  it("sets denied ad consent and disables Google advertising signals", async () => {
    const { deferAnalytics } = await import("../../client/lib/analytics");

    const cleanup = deferAnalytics();

    expect(reactGa.initialize).not.toHaveBeenCalled();
    expect(dataLayerCommands()).toEqual([
      [
        "consent",
        "default",
        {
          ad_personalization: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          analytics_storage: "granted",
        },
      ],
      [
        "set",
        {
          allow_ad_personalization_signals: false,
          allow_google_signals: false,
        },
      ],
    ]);

    window.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(reactGa.initialize).toHaveBeenCalledOnce());

    expect(reactGa.initialize).toHaveBeenCalledWith("G-PRIVACY-TEST", {
      gaOptions: {
        allowAdFeatures: false,
        allowAdPersonalizationSignals: false,
      },
    });
    cleanup();
  });
});
