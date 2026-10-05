// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    window.history.replaceState(
      null,
      "",
      "/clinton/mukilteo/navigation?tripMode=walk#tripAddress=Private+Starting+Address"
    );
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
          page_location:
            "http://localhost:3000/clinton/mukilteo/navigation?tripMode=walk",
          page_referrer: "",
        },
      ],
    ]);

    window.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(reactGa.initialize).toHaveBeenCalledOnce());

    expect(reactGa.initialize).toHaveBeenCalledWith("G-PRIVACY-TEST", {
      gtagOptions: {
        page_location:
          "http://localhost:3000/clinton/mukilteo/navigation?tripMode=walk",
        page_referrer: "",
      },
      gaOptions: {
        allowAdFeatures: false,
        allowAdPersonalizationSignals: false,
      },
    });
    const { trackEvent } = await import("../../client/lib/analytics");
    trackEvent("Navigation", "Share trip");
    await vi.waitFor(() => expect(reactGa.event).toHaveBeenCalled());
    expect(
      JSON.stringify([
        window.dataLayer,
        reactGa.initialize.mock.calls,
        reactGa.set.mock.calls,
        reactGa.event.mock.calls,
      ])
    ).not.toContain("Private");
    cleanup();
  });

  // protect pageview payloads on both the tag-manager and direct analytics paths
  it("removes private addresses from deferred route pageviews", async () => {
    const { deferAnalytics, useRecordPageViews } =
      await import("../../client/lib/analytics");
    // exercise the real pageview effect without unrelated app dependencies
    const Pageview = () => {
      useRecordPageViews();
      return null;
    };
    const cleanup = deferAnalytics();
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(() => {
        root.render(
          createElement(
            MemoryRouter,
            {
              initialEntries: [
                `${window.location.pathname}${window.location.search}${window.location.hash}`,
              ],
            },
            createElement(Pageview)
          )
        );
      });
      expect(window.dataLayer).toContainEqual({
        event: "page_view",
        page_path: "/clinton/mukilteo/navigation",
        page_location:
          "http://localhost:3000/clinton/mukilteo/navigation?tripMode=walk",
        page_referrer: "",
      });
      window.dispatchEvent(new Event("pointerdown"));
      await vi.waitFor(() =>
        expect(reactGa.send).toHaveBeenCalledWith({
          hitType: "pageview",
          page: "/clinton/mukilteo/navigation",
        })
      );
      expect(reactGa.set).toHaveBeenCalledWith({
        page_location:
          "http://localhost:3000/clinton/mukilteo/navigation?tripMode=walk",
        page_referrer: "",
      });
      const payloads = JSON.stringify([
        window.dataLayer,
        reactGa.initialize.mock.calls,
        reactGa.set.mock.calls,
        reactGa.send.mock.calls,
      ]);
      expect(payloads).not.toContain("tripAddress");
      expect(payloads).not.toContain("Private");
    } finally {
      await act(() => root.unmount());
      cleanup();
    }
  });
});
