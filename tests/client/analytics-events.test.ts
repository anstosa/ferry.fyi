// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ga = vi.hoisted(() => ({
  initialize: vi.fn(),
  event: vi.fn(),
  send: vi.fn(),
}));
vi.mock("react-ga4", () => ({ default: ga }));

// isolate module-owned queue and activation state
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  ga.initialize.mockReset();
  ga.event.mockReset();
  vi.stubEnv("GOOGLE_ANALYTICS", "G-USEFUL-FIXTURE");
  vi.stubEnv("GTM_CONTAINER_ID", "");
  delete window.dataLayer;
  window.history.replaceState(
    null,
    "",
    "/route-a?secret=UV_PRIVATE#UV_PRIVATE"
  );
  document.title = "UV_PRIVATE_TITLE";
});
// restore browser configuration
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.dataLayer;
});

const catalog = [
  ["useful_content_view", { surface: "schedule" }],
  ["install_prompt", { result: "accepted" }],
  ["install_store_opened", { store: "google" }],
  ["pwa_install_completed", {}],
  ["alert_saved", { kind: "recurring" }],
  ["share_completed", { surface: "trip_plan", method: "clipboard" }],
  ["trip_plan_available", { travel_mode: "walk", result: "timing_only" }],
  ["fare_quote_available", { freshness: "stale" }],
] as const;

// allow unsafe inputs only at the runtime-boundary test seam
const unsafeTracker = (tracker: unknown) =>
  tracker as (name: string, params: unknown) => void;
// advance provider initialization and queued dispatch
const flush = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
};

describe("closed product analytics", () => {
  // the intent api cannot create an orphan useful event
  it("keeps qualifiers private to the paired boundary", async () => {
    const analytics = await import("../../client/lib/analytics");
    const intent = unsafeTracker(analytics.trackProductEvent);
    intent("useful_visit", {});
    unsafeTracker(analytics.trackUsefulEvent)("useful_visit", {});
    // even exact qualifying payloads cannot bypass their required pair
    for (const [name, params] of catalog) {
      if (name !== "install_prompt" && name !== "install_store_opened")
        intent(name, params);
    }
    analytics.trackUsefulEvent("pwa_install_completed");
    await flush();
    expect(ga.event.mock.calls.map(([name]) => name)).toEqual([
      "pwa_install_completed",
      "useful_visit",
    ]);
  });

  // exact catalog payloads must survive without a legacy mirror
  it.each(catalog)("accepts %s with fixed parameters", async (name, params) => {
    const analytics = await import("../../client/lib/analytics");
    const tracker =
      name === "install_prompt" || name === "install_store_opened"
        ? analytics.trackProductEvent
        : analytics.trackUsefulEvent;
    unsafeTracker(tracker)(name, params);
    const cleanup = analytics.deferAnalytics();
    window.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(ga.event).toHaveBeenCalledWith(name, {
      ...params,
      page_location: "http://localhost:3000/route-a",
      page_referrer: "",
      page_title: "Ferry FYI",
      send_to: "G-USEFUL-FIXTURE",
    });
    expect(
      window.dataLayer?.some(
        (entry) => "event" in entry && entry.event === "ferry_fyi_event"
      )
    ).toBe(false);
    cleanup();
  });

  // every schema rejects missing keys, overrides and malformed values before queuing
  it.each(catalog)("rejects invalid %s payloads", async (name, params) => {
    const analytics = await import("../../client/lib/analytics");
    const tracker =
      name === "install_prompt" || name === "install_store_opened"
        ? analytics.trackProductEvent
        : analytics.trackUsefulEvent;
    const track = unsafeTracker(tracker);
    track("unknown", params);
    track(name, { ...params, page_title: "UV_PRIVATE" });
    track(name, { ...params, send_to: "UV_PRIVATE" });
    track(name, null);
    track(name, { ...params, [Symbol("private")]: "UV_PRIVATE" });
    track(name, new Date());
    track(name, []);
    track(name, "UV_PRIVATE");
    // alter each required field independently
    for (const key of Object.keys(params)) {
      track(name, { ...params, [key]: "UV_PRIVATE" });
      track(name, { ...params, [key]: {} });
      track(
        name,
        Object.defineProperty({ ...params }, key, { get: () => "UV_PRIVATE" })
      );
      const missing = { ...params } as Record<string, unknown>;
      delete missing[key];
      track(name, missing);
    }
    analytics.trackUsefulEvent("pwa_install_completed");
    await flush();
    expect(ga.event.mock.calls.map(([event]) => event)).toEqual([
      "pwa_install_completed",
      "useful_visit",
    ]);
    expect(
      JSON.stringify([
        window.dataLayer,
        ga.initialize.mock.calls,
        ga.event.mock.calls,
      ])
    ).not.toContain("UV_PRIVATE");
  });

  // ga sessions, not a document boolean, aggregate useful visits
  it("pairs every later outcome and captures each occurrence route before provider flush", async () => {
    const analytics = await import("../../client/lib/analytics");
    analytics.trackEvent("Navigation", "Open Menu");
    analytics.trackUsefulEvent("share_completed", {
      surface: "schedule",
      method: "clipboard",
    });
    window.history.replaceState(
      null,
      "",
      "/route-b?secret=UV_PRIVATE#UV_PRIVATE"
    );
    analytics.trackUsefulEvent("alert_saved", { kind: "one_time" });
    await flush();
    expect(ga.event.mock.calls.map(([name]) => name)).toEqual([
      "Open Menu",
      "share_completed",
      "useful_visit",
      "alert_saved",
      "useful_visit",
    ]);
    expect(
      ga.event.mock.calls
        .slice(0, 3)
        .every(([, params]) => params.page_location.endsWith("/route-a"))
    ).toBe(true);
    expect(
      ga.event.mock.calls
        .slice(3)
        .every(([, params]) => params.page_location.endsWith("/route-b"))
    ).toBe(true);
    expect(ga.initialize.mock.calls[0][1].gtagOptions).toMatchObject({
      send_page_view: false,
      page_location: "http://localhost:3000/route-b",
    });
    expect(
      JSON.stringify([
        window.dataLayer,
        ga.initialize.mock.calls,
        ga.event.mock.calls,
      ])
    ).not.toContain("UV_PRIVATE");
  });

  // preserve exactly the three established navigation pairs
  it("drops arbitrary legacy strings and keeps known pairs", async () => {
    const analytics = await import("../../client/lib/analytics");
    analytics.trackEvent("UV_PRIVATE", "Open Menu");
    analytics.trackEvent("Navigation", "UV_PRIVATE");
    // exercise every legacy compatibility action
    for (const action of ["Open Menu", "Close Menu", "Swap Terminals"])
      analytics.trackEvent("Navigation", action);
    analytics.trackUsefulEvent("pwa_install_completed");
    await flush();
    expect(ga.event.mock.calls.slice(0, 3).map(([name]) => name)).toEqual([
      "Open Menu",
      "Close Menu",
      "Swap Terminals",
    ]);
    expect(
      window.dataLayer?.filter(
        (entry) => "event" in entry && entry.event === "ferry_fyi_event"
      )
    ).toHaveLength(3);
  });

  // pending transport must preserve every complete pair across long queues
  it("never trims a specific outcome away from its qualifier", async () => {
    const analytics = await import("../../client/lib/analytics");
    // enqueue more than the prior arbitrary capacity before the import resolves
    for (let index = 0; index < 101; index += 1)
      analytics.trackUsefulEvent("pwa_install_completed");
    analytics.trackProductEvent("install_prompt", { result: "opened" });
    await flush();
    expect(ga.event).toHaveBeenCalledTimes(203);
    // each specific outcome remains immediately adjacent to its useful visit
    for (let index = 0; index < 202; index += 2)
      expect(
        ga.event.mock.calls.slice(index, index + 2).map(([name]) => name)
      ).toEqual(["pwa_install_completed", "useful_visit"]);
  });

  // strict-mode cleanup must not re-prepare or load tags twice
  it("defers install intent and initializes once on passive qualification", async () => {
    const analytics = await import("../../client/lib/analytics");
    analytics.deferAnalytics()();
    const cleanup = analytics.deferAnalytics();
    analytics.trackProductEvent("install_prompt", { result: "opened" });
    await flush();
    expect(ga.initialize).not.toHaveBeenCalled();
    analytics.trackUsefulEvent("pwa_install_completed");
    window.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(ga.initialize).toHaveBeenCalledOnce();
    expect(
      window.dataLayer?.filter(
        (entry) => "length" in entry && entry[0] === "consent"
      )
    ).toHaveLength(1);
    cleanup();
  });

  // missing or throwing providers must never break rider actions
  it.each(["missing", "initialize", "event"])(
    "fails open for %s provider",
    async (failure) => {
      // choose a deterministic provider failure
      if (failure === "missing") vi.stubEnv("GOOGLE_ANALYTICS", "");
      // initialization failure is caught before queue drain
      if (failure === "initialize")
        ga.initialize.mockImplementation(() => {
          throw new Error("blocked");
        });
      // individual dispatch failures are isolated
      if (failure === "event")
        ga.event.mockImplementation(() => {
          throw new Error("blocked");
        });
      const analytics = await import("../../client/lib/analytics");
      expect(() =>
        analytics.trackUsefulEvent("pwa_install_completed")
      ).not.toThrow();
      await flush();
      // no initialization is attempted without a configured measurement id
      if (failure === "missing") expect(ga.initialize).not.toHaveBeenCalled();
    }
  );
});
