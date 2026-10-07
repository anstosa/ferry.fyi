/* eslint-disable require-await -- injected loaders deliberately model async service calls. */
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { getPublicAdServingFingerprint } from "../../server/services/public/adTracking";
import {
  type PublicSsrServerEntry,
  renderPublicSsrDocument,
} from "../../server/ssr/document";
import { SsrDocumentCache } from "../../server/ssr/documentCache";
import {
  createSsrDocumentRuntime,
  isPublicSsrDocumentCacheable,
  type SsrRuntimeFill,
} from "../../server/ssr/documentRuntime";
import {
  createPublicSsrCanonicalResolver,
  createPublicSsrTerminalResolver,
  type PublicSsrLoadResult,
  PublicSsrTransientFailure,
} from "../../server/ssr/publicSnapshot";
import type { AdCampaignCreative } from "../../shared/contracts/ads";
import { PUBLIC_SSR_SNAPSHOT_VERSION } from "../../shared/contracts/ssr";
import type { Terminal } from "../../shared/contracts/terminals";
import {
  getPublicSsrAdPlacementBinding,
  type PublicSsrAdServingBinding,
} from "../../shared/lib/ssrAdPlacement";
import { matchPublicSsrRoute } from "../../shared/lib/ssrRouteMatch";

const template = '<html><head></head><body><div id="root"></div></body></html>';

const rendererFor = (entry: PublicSsrServerEntry) => ({
  artifactVersion: 1 as const,
  renderPublicSsrDocument: (input: {
    renderedAt: number;
    requestUrl: string;
    seoBaseUrl: string;
    seoHost: string;
    seoPathname: string;
    snapshot: unknown;
    template: string;
  }) =>
    renderPublicSsrDocument({
      context: {
        clock: () => input.renderedAt,
        platform: "web",
        requestUrl: input.requestUrl,
        runtime: "server",
        seoBaseUrl: input.seoBaseUrl,
        seoHost: input.seoHost,
        seoPathname: input.seoPathname,
      },
      entry,
      snapshot: input.snapshot,
      template: input.template,
    }),
});
const resolver = createPublicSsrTerminalResolver();
const match = (url: URL) => matchPublicSsrRoute(url, resolver);
const resolve = async (url: URL) => {
  const matched = match(url);
  if (!matched) {
    return { classification: "unknown" as const };
  }
  return matched.route.kind === "private"
    ? { classification: "private" as const, match: matched }
    : { classification: "eligible" as const, match: matched };
};

const aboutSnapshot = () => ({
  canonicalHost: "ferry.fyi" as const,
  canonicalPath: "/about",
  hostProfile: "ferry.fyi" as const,
  indexability: "indexable" as const,
  metadata: {
    canonicalPath: "/about",
    description: "Public about document",
    robots: "index,follow" as const,
    title: "About - Ferry FYI",
  },
  normalizedUrl: { path: "/about", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "about" as const,
  routeParams: {},
  sources: {
    editorial: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value" as const,
      sourceUpdatedAt: null,
      value: {
        contentRevision: "test",
        release: { publishedAt: null, version: "test" },
      },
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
});

const todaySnapshot = () => ({
  canonicalHost: "ferry.fyi" as const,
  canonicalPath: "/today",
  hostProfile: "ferry.fyi" as const,
  indexability: "indexable" as const,
  metadata: {
    canonicalPath: "/today",
    description: "Today's sailings",
    robots: "index,follow" as const,
    title: "Today - Ferry FYI",
  },
  normalizedUrl: { path: "/today", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "today" as const,
  routeParams: {},
  sources: {
    nextSchedule: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    },
    notices: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    },
    route: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    },
    schedule: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    },
    wsf: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "authoritatively-unavailable" as const,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
});

// build one valid home snapshot from the injected serving decision
const homeSnapshot = (serving: PublicSsrAdServingBinding) => ({
  canonicalHost: "ferry.fyi" as const,
  canonicalPath: "/",
  hostProfile: "ferry.fyi" as const,
  indexability: "indexable" as const,
  metadata: {
    canonicalPath: "/",
    description: "Current Washington State Ferries information",
    robots: "index,follow" as const,
    title: "Ferry FYI",
  },
  normalizedUrl: { path: "/", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "home" as const,
  routeParams: {},
  sources: {
    ad: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value" as const,
      sourceUpdatedAt: null,
      value: {
        creative: serving.creative,
        placementKey: serving.placementKey,
      },
    },
    features: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value" as const,
      sourceUpdatedAt: null,
      value: { leaderboardsEnabled: true },
    },
    notices: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "empty" as const,
      sourceUpdatedAt: null,
      value: {
        announcements: [],
        maintenance: { enabled: false, message: "" },
      },
    },
    terminals: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "empty" as const,
      sourceUpdatedAt: null,
      value: [],
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
});

// build one immutable public creative fixture
const creative = (campaignId: string): AdCampaignCreative => ({
  advertiserName: `Advertiser ${campaignId}`,
  body: `Body ${campaignId}`,
  campaignId,
  headline: `Headline ${campaignId}`,
  placementKey: "home",
  targetUrl: `https://example.com/${campaignId}`,
});

// bind a runtime to a shared mutable serving-state fixture
const createHomeRuntime = ({
  blockFirstLoad,
  cache = new SsrDocumentCache<SsrRuntimeFill>(),
  cacheEnabled = true,
  clock = () => new Date("2026-07-28T12:00:00.000Z"),
  servingState,
}: {
  blockFirstLoad?: Promise<void>;
  cache?: SsrDocumentCache<SsrRuntimeFill>;
  cacheEnabled?: boolean;
  clock?: () => Date;
  servingState: {
    current: AdCampaignCreative | null;
    errorAt?: number;
    now: Date;
    reads: number;
  };
}) => {
  const home = match(new URL("https://ferry.fyi/"));
  if (!home) {
    throw new Error("Home route must be present");
  }
  const adPlacementBinding = getPublicSsrAdPlacementBinding(home);
  if (!adPlacementBinding) {
    throw new Error("Home placement must be present");
  }
  const resolveAdServingState = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retain the timestamp for serving-decision assertions
    async (placementKey: string, _now: Date) => {
      servingState.reads += 1;
      // simulate a selected authoritative database failure
      if (servingState.errorAt === servingState.reads) {
        throw new Error("private database detail");
      }
      return {
        creative: servingState.current,
        fingerprint: getPublicAdServingFingerprint(
          placementKey,
          servingState.current
        ),
        placementKey,
      };
    }
  );
  let loads = 0;
  const load = vi.fn(async (input) => {
    loads += 1;
    // hold the first candidate across a serving-state transition
    if (loads === 1 && blockFirstLoad) {
      await blockFirstLoad;
    }
    if (!input.adServingBinding) {
      throw new Error("Expected an injected serving binding");
    }
    return {
      classification: "snapshot" as const,
      match: home,
      snapshot: homeSnapshot(input.adServingBinding),
    };
  });
  const telemetry = vi.fn();
  const run = createSsrDocumentRuntime({
    cache,
    clock,
    config: { cacheEnabled, enabled: true },
    contentRevision: () => "test",
    load,
    release: () => ({ publishedAt: null, version: "test" }),
    renderer: rendererFor({
      createServerApp: ({ snapshot }) => {
        const { ad } = snapshot.sources;
        const headline =
          ad?.outcome === "value" ? ad.value.creative?.headline : null;
        return React.createElement("main", null, headline ?? "Empty ad slot");
      },
    }),
    resolve: async () => ({
      adPlacementBinding,
      classification: "eligible" as const,
      match: home,
    }),
    resolveAdServingState,
    servingClock: () => servingState.now,
    telemetry,
    template,
  });
  return { cache, load, resolveAdServingState, run, telemetry };
};

const terminal = (id: string, name: string): Terminal => ({
  abbreviation: name.slice(0, 3).toUpperCase(),
  bulletins: [],
  cameras: [],
  hasElevator: false,
  hasFood: false,
  hasOverheadLoading: false,
  hasRestroom: true,
  hasWaitingRoom: true,
  id,
  info: {},
  location: { address: {}, latitude: 47, longitude: -122 },
  name,
  popularity: 1,
  routes: {},
  waitTimes: [],
});

const createRuntime = (
  overrides: {
    cache?: SsrDocumentCache<SsrRuntimeFill>;
    clock?: () => Date;
    config?: { cacheEnabled: boolean; enabled: boolean };
    load?: () => Promise<PublicSsrLoadResult>;
    monotonicClock?: () => number;
  } = {}
) => {
  const matched = match(new URL("https://ferry.fyi/about"));
  if (!matched) {
    throw new Error("About route must be present");
  }
  const load =
    overrides.load ??
    vi.fn(async () => ({
      classification: "snapshot" as const,
      match: matched,
      snapshot: aboutSnapshot(),
    }));
  const telemetry = vi.fn();
  const run = createSsrDocumentRuntime({
    cache: overrides.cache ?? new SsrDocumentCache<SsrRuntimeFill>(),
    clock: overrides.clock ?? (() => new Date("2026-07-28T12:00:00.000Z")),
    config: overrides.config ?? { cacheEnabled: true, enabled: true },
    contentRevision: () => "test",
    renderer: rendererFor({
      createServerApp: () =>
        React.createElement("main", null, "server document"),
    }),
    load,
    monotonicClock: overrides.monotonicClock,
    resolve,
    release: () => ({ publishedAt: null, version: "test" }),
    telemetry,
    template,
  });
  return { load, run, telemetry };
};

const createCanonicalRuntime = (
  getTerminals: () => Promise<Record<string, Terminal>>
) => {
  const cache = new SsrDocumentCache<SsrRuntimeFill>();
  const load = vi.fn(async () => {
    throw new Error("canonical responses must not load documents");
  });
  const run = createSsrDocumentRuntime({
    cache,
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    config: { cacheEnabled: true, enabled: true },
    contentRevision: () => "test",
    renderer: rendererFor({
      createServerApp: () => React.createElement("main"),
    }),
    load,
    release: () => ({ publishedAt: null, version: "test" }),
    resolve: createPublicSsrCanonicalResolver({ getTerminals }),
    template,
  });
  return { cache, load, run };
};

describe("SSR document runtime cache integration", () => {
  it("allows ad documents while rejecting transient source outcomes", () => {
    expect(
      isPublicSsrDocumentCacheable({
        sources: {
          ad: {
            observedAt: "2026-08-04T12:00:00.000Z",
            outcome: "authoritatively-unavailable",
          },
        },
      })
    ).toBe(true);
    expect(
      isPublicSsrDocumentCacheable({
        sources: {
          editorial: {
            observedAt: "2026-08-04T12:00:00.000Z",
            outcome: "value",
          },
        },
      })
    ).toBe(true);
    expect(
      isPublicSsrDocumentCacheable({
        sources: {
          schedule: {
            observedAt: "2026-08-04T12:00:00.000Z",
            outcome: "transiently-unavailable",
          },
        },
      })
    ).toBe(false);
  });
  it("keeps real resolver redirects and failures outside the document cache", async () => {
    const noTerminals = vi.fn(async () => ({}));
    const { cache, load, run } = createCanonicalRuntime(noTerminals);
    const cacheLookup = vi.spyOn(cache, "getOrCreate");

    await expect(
      run("https://ferry.fyi/cli?tracking=canary")
    ).resolves.toMatchObject({ redirect: "/clinton", status: 301 });
    await expect(
      run("https://ferry.fyi/forecasting-explained?tracking=canary")
    ).resolves.toMatchObject({ redirect: "/forecasting", status: 301 });
    await expect(
      run("https://ferry.fyi/seattle/bainbridge/terminal")
    ).resolves.toMatchObject({ redirect: "/seattle/terminal", status: 301 });
    expect(noTerminals).not.toHaveBeenCalled();
    expect(cacheLookup).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();

    const clinton = terminal("5", "Clinton");
    const mukilteo = terminal("14", "Mukilteo");
    clinton.mates = [mukilteo];
    const oneMate = createCanonicalRuntime(async () => ({
      "5": clinton,
      "14": mukilteo,
    }));
    const oneMateLookup = vi.spyOn(oneMate.cache, "getOrCreate");
    await expect(run("https://ferry.fyi/clinton")).resolves.toMatchObject({
      status: 503,
    });
    await expect(
      oneMate.run("https://ferry.fyi/clinton/mukilteo")
    ).resolves.toMatchObject({ redirect: "/clinton", status: 301 });
    expect(oneMateLookup).not.toHaveBeenCalled();
    expect(oneMate.load).not.toHaveBeenCalled();

    const coupeville = terminal("10", "Coupeville");
    const multiMate = createCanonicalRuntime(async () => ({
      "5": { ...clinton, mates: [mukilteo, coupeville] },
      "10": coupeville,
      "14": mukilteo,
    }));
    const multiMateLookup = vi.spyOn(multiMate.cache, "getOrCreate");
    await expect(
      multiMate.run("https://ferry.fyi/clinton")
    ).resolves.toMatchObject({
      redirect: "/clinton/mukilteo",
      status: 301,
    });
    expect(multiMateLookup).not.toHaveBeenCalled();
    expect(multiMate.load).not.toHaveBeenCalled();
  });
  it("renders a static document once then serves a cached hit", async () => {
    const { load, run, telemetry } = createRuntime();
    const first = await run("https://ferry.fyi/about?tracking=canary");
    const second = await run("https://ferry.fyi/about?tracking=other");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.html).toContain("server document");
    expect(load).toHaveBeenCalledTimes(1);
    const documentEvents = telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document");
    expect(documentEvents.map(({ cacheOutcome }) => cacheOutcome)).toEqual([
      "miss",
      "hit",
    ]);
    expect(documentEvents.map(({ safeQuery }) => safeQuery)).toEqual(["", ""]);
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("canary");
  });

  it("attributes document and source phases with explicit millisecond units", async () => {
    let monotonicNow = 0;
    const matched = match(new URL("https://ferry.fyi/about"));
    if (!matched) {
      throw new Error("About route must be present");
    }
    const runtime = createRuntime({
      load: vi.fn(async () => {
        monotonicNow += 12;
        return {
          classification: "snapshot" as const,
          match: matched,
          snapshot: aboutSnapshot(),
          sourceDurationsMs: { editorial: 7 },
        };
      }),
      monotonicClock: () => monotonicNow,
    });

    await runtime.run("https://ferry.fyi/about");

    const event = runtime.telemetry.mock.calls
      .map(([value]) => value)
      .find(({ event }) => event === "ssr_document");
    expect(event?.phases).toEqual({
      cache: 0,
      render: 0,
      routeResolve: 0,
      snapshotLoad: 12,
      snapshotValidation: 0,
      sourceGroups: { editorial: 7 },
      total: 12,
      unit: "milliseconds",
    });
  });

  it("coalesces twenty identical document requests and does not load while disabled", async () => {
    let resolve!: (value: PublicSsrLoadResult) => void;
    const pending = new Promise<PublicSsrLoadResult>(
      (done) => (resolve = done)
    );
    const { load, run } = createRuntime({ load: vi.fn(() => pending) });
    const requests = Array.from({ length: 20 }, () =>
      run("https://ferry.fyi/about")
    );
    const matched = match(new URL("https://ferry.fyi/about"));
    if (!matched) {
      throw new Error("About route must be present");
    }
    resolve({
      classification: "snapshot",
      match: matched,
      snapshot: aboutSnapshot(),
    });
    expect(
      (await Promise.all(requests)).every((response) => response.status === 200)
    ).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    const disabled = createRuntime({
      config: { cacheEnabled: true, enabled: false },
    });
    await expect(
      disabled.run("https://ferry.fyi/about")
    ).resolves.toMatchObject({ status: 200 });
    expect(disabled.load).not.toHaveBeenCalled();
  });

  it("commits a static fill that crosses 03:00 and serves the next request from cache", async () => {
    let now = new Date("2026-07-28T09:59:00.000Z");
    let resolve!: (value: PublicSsrLoadResult) => void;
    const pending = new Promise<PublicSsrLoadResult>(
      (done) => (resolve = done)
    );
    const { load, run } = createRuntime({
      clock: () => now,
      load: vi.fn(() => pending),
    });
    const first = run("https://ferry.fyi/about");
    const matched = match(new URL("https://ferry.fyi/about"));
    if (!matched) {
      throw new Error("About route must be present");
    }
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    now = new Date("2026-07-28T10:01:00.000Z");
    resolve({
      classification: "snapshot",
      match: matched,
      snapshot: aboutSnapshot(),
    });
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(run("https://ferry.fyi/about")).resolves.toMatchObject({
      status: 200,
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns but does not commit a dynamic fill that crosses 03:00", async () => {
    let now = new Date("2026-07-28T09:59:00.000Z");
    let resolve!: (value: PublicSsrLoadResult) => void;
    const pending = new Promise<PublicSsrLoadResult>(
      (done) => (resolve = done)
    );
    const { load, run } = createRuntime({
      clock: () => now,
      load: vi.fn(() => pending),
    });
    const first = run("https://ferry.fyi/today");
    const today = match(new URL("https://ferry.fyi/today"));
    if (!today) {
      throw new Error("Today route must be present");
    }
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    now = new Date("2026-07-28T10:01:00.000Z");
    resolve({
      classification: "snapshot",
      match: today,
      snapshot: todaySnapshot(),
    });
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(run("https://ferry.fyi/today")).resolves.toMatchObject({
      status: 200,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("returns but does not cache a document with transient source outcomes", async () => {
    const today = match(new URL("https://ferry.fyi/today"));
    if (!today) {
      throw new Error("Today route must be present");
    }
    const warming = {
      ...todaySnapshot(),
      sources: {
        ...todaySnapshot().sources,
        schedule: {
          observedAt: "2026-07-28T12:00:00.000Z",
          outcome: "transiently-unavailable" as const,
          reason: "warming" as const,
          sourceUpdatedAt: null,
        },
      },
    };
    const settled = todaySnapshot();
    const load = vi
      .fn<() => Promise<PublicSsrLoadResult>>()
      .mockResolvedValueOnce({
        classification: "snapshot",
        match: today,
        snapshot: warming,
      })
      .mockResolvedValue({
        classification: "snapshot",
        match: today,
        snapshot: settled,
      });
    const runtime = createRuntime({ load });

    await expect(runtime.run("https://ferry.fyi/today")).resolves.toMatchObject(
      { status: 200 }
    );
    await expect(runtime.run("https://ferry.fyi/today")).resolves.toMatchObject(
      { status: 200 }
    );
    await expect(runtime.run("https://ferry.fyi/today")).resolves.toMatchObject(
      { status: 200 }
    );

    expect(load).toHaveBeenCalledTimes(2);
    const cacheOutcomes = runtime.telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document")
      .map(({ cacheOutcome }) => cacheOutcome);
    expect(cacheOutcomes).toEqual(["miss", "miss", "hit"]);
  });

  it("reuses dynamic documents until the next fixed refresh boundary", async () => {
    let now = new Date("2026-07-28T21:58:00.000Z");
    const today = match(new URL("https://ferry.fyi/today"));
    if (!today) {
      throw new Error("Today route must be present");
    }
    const load = vi.fn(async () => ({
      classification: "snapshot" as const,
      match: today,
      snapshot: todaySnapshot(),
    }));
    const runtime = createRuntime({ clock: () => now, load });

    await runtime.run("https://ferry.fyi/today");
    now = new Date("2026-07-28T21:59:59.999Z");
    await runtime.run("https://ferry.fyi/today");
    now = new Date("2026-07-28T22:00:00.000Z");
    await runtime.run("https://ferry.fyi/today");

    expect(load).toHaveBeenCalledTimes(2);
    expect(
      runtime.telemetry.mock.calls
        .map(([event]) => event)
        .filter(({ event }) => event === "ssr_document")
        .map(({ cacheOutcome }) => cacheOutcome)
    ).toEqual(["miss", "hit", "miss"]);
  });

  it("coalesces cache-disabled documents without persistence and marks every event", async () => {
    let resolve!: (value: PublicSsrLoadResult) => void;
    const pending = new Promise<PublicSsrLoadResult>(
      (done) => (resolve = done)
    );
    const { load, run, telemetry } = createRuntime({
      config: { cacheEnabled: false, enabled: true },
      load: vi.fn(() => pending),
    });
    const requests = Array.from({ length: 20 }, () =>
      run("https://ferry.fyi/about")
    );
    const matched = match(new URL("https://ferry.fyi/about"));
    if (!matched) {
      throw new Error("About route must be present");
    }
    resolve({
      classification: "snapshot",
      match: matched,
      snapshot: aboutSnapshot(),
    });
    await Promise.all(requests);
    await run("https://ferry.fyi/about");
    expect(load).toHaveBeenCalledTimes(2);
    const documentEvents = telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document");
    expect(documentEvents).toHaveLength(21);
    expect(
      documentEvents.every(
        ({ controlReason }) => controlReason === "cache_bypassed"
      )
    ).toBe(true);
  });

  it("does not commit transient source failures and retries the next fill", async () => {
    const matched = match(new URL("https://ferry.fyi/about"));
    if (!matched) {
      throw new Error("About route must be present");
    }
    let attempts = 0;
    const cache = new SsrDocumentCache<SsrRuntimeFill>();
    const { run } = createRuntime({
      cache,
      load: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new PublicSsrTransientFailure("vessels");
        }
        return {
          classification: "snapshot",
          match: matched,
          snapshot: aboutSnapshot(),
        };
      },
    });
    const failed = await run("https://ferry.fyi/about");
    expect(failed).toMatchObject({ status: 503 });
    expect(failed.html).not.toContain("vessels");
    expect(cache.sizes).toEqual({ dynamic: 0, inFlight: 0, static: 0 });
    await expect(run("https://ferry.fyi/about")).resolves.toMatchObject({
      status: 200,
    });
    expect(attempts).toBe(2);
    expect(cache.sizes).toEqual({ dynamic: 0, inFlight: 0, static: 1 });
  });

  // keep the content window separate from later ad-serving observations
  it.each([
    ["03:00", "2026-07-28T09:59:59.999Z", "2026-07-28T10:00:00.000Z"],
    ["15:00", "2026-07-28T21:59:59.999Z", "2026-07-28T22:00:00.000Z"],
  ])(
    "does not persist old content under a new %s ad window",
    async (_label, before, after) => {
      let now = new Date(before);
      const servingState = {
        current: creative("A"),
        now: new Date(after),
        reads: 0,
      };
      const runtime = createHomeRuntime({ clock: () => now, servingState });
      const home = match(new URL("https://ferry.fyi/"));
      // require the fixture route before observing cached content
      if (!home) {
        throw new Error("Home route must be present");
      }
      runtime.load.mockImplementation(async (input) => {
        now = new Date(after);
        return {
          classification: "snapshot" as const,
          match: home,
          snapshot: {
            ...homeSnapshot(input.adServingBinding),
            renderedAt: input.fixedClock.toISOString(),
          },
        };
      });

      const old = await runtime.run("https://ferry.fyi/");
      expect(old.status).toBe(200);
      expect(old.html).toContain(before);
      expect(runtime.cache.sizes.dynamic).toBe(0);
      const fresh = await runtime.run("https://ferry.fyi/");
      expect(fresh.status).toBe(200);
      expect(fresh.html).toContain(after);
      expect(fresh.html).not.toContain(before);
      expect(runtime.cache.sizes.dynamic).toBe(1);
      expect((await runtime.run("https://ferry.fyi/")).html).toBe(fresh.html);
      expect(runtime.load).toHaveBeenCalledTimes(2);
    }
  );

  // sample the content clock after the final database observation completes
  it("does not commit across a refresh boundary during ad validation", async () => {
    let now = new Date("2026-07-28T09:59:59.999Z");
    const servingState = { current: creative("A"), now, reads: 0 };
    const runtime = createHomeRuntime({ clock: () => now, servingState });
    runtime.resolveAdServingState.mockImplementation(async (placementKey) => {
      servingState.reads += 1;
      // advance the content clock during the final serving decision
      if (servingState.reads === 2) {
        now = new Date("2026-07-28T10:00:00.000Z");
        servingState.now = now;
      }
      return {
        creative: servingState.current,
        fingerprint: getPublicAdServingFingerprint(
          placementKey,
          servingState.current
        ),
        placementKey,
      };
    });

    expect((await runtime.run("https://ferry.fyi/")).status).toBe(200);
    expect(runtime.cache.sizes.dynamic).toBe(0);
    expect((await runtime.run("https://ferry.fyi/")).status).toBe(200);
    expect(runtime.cache.sizes.dynamic).toBe(1);
    expect(runtime.load).toHaveBeenCalledTimes(2);
  });

  it("caches a stable ad document and performs the exact miss and hit decisions", async () => {
    const servingState = {
      current: creative("A"),
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const runtime = createHomeRuntime({ servingState });

    const first = await runtime.run("https://ferry.fyi/");
    const second = await runtime.run("https://ferry.fyi/");

    expect(first.html).toContain("Headline A");
    expect(second.html).toBe(first.html);
    expect(runtime.load).toHaveBeenCalledOnce();
    expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(3);
    const events = runtime.telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document");
    expect(events).toMatchObject([
      {
        adResolutionCount: 2,
        adRetryCount: 0,
        adValidationOutcome: "stable",
        cacheOutcome: "miss",
        renderCount: 1,
        snapshotLoadCount: 1,
      },
      {
        adResolutionCount: 1,
        adRetryCount: 0,
        adValidationOutcome: "stable",
        cacheOutcome: "hit",
        renderCount: 0,
        snapshotLoadCount: 0,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Headline A");
    expect(JSON.stringify(events)).not.toContain("https://example.com/A");
    expect(JSON.stringify(events)).not.toContain(
      getPublicAdServingFingerprint("home", servingState.current)
    );
  });

  it.each([
    ["campaign start", null, creative("started")],
    ["campaign end", creative("ending"), null],
    ["campaign early end", creative("early"), null],
  ])(
    "invalidates an origin fill and coalesced waiter at exact %s",
    async (_label, before, after) => {
      let release!: () => void;
      const blocked = new Promise<void>((done) => (release = done));
      const servingState = {
        current: before,
        now: new Date("2026-07-28T12:00:00.000Z"),
        reads: 0,
      };
      const runtime = createHomeRuntime({
        blockFirstLoad: blocked,
        servingState,
      });
      const secondRuntime = createHomeRuntime({
        blockFirstLoad: blocked,
        servingState,
      });

      const origin = runtime.run("https://ferry.fyi/");
      const secondOrigin = secondRuntime.run("https://ferry.fyi/");
      await vi.waitFor(() => {
        expect(runtime.load).toHaveBeenCalledOnce();
        expect(secondRuntime.load).toHaveBeenCalledOnce();
      });
      const waiter = runtime.run("https://ferry.fyi/");
      const secondWaiter = secondRuntime.run("https://ferry.fyi/");
      await vi.waitFor(() => {
        expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(2);
        expect(secondRuntime.resolveAdServingState).toHaveBeenCalledTimes(2);
      });
      const transitionAt = new Date("2026-07-28T12:01:00.000Z");
      servingState.current = after;
      servingState.now = transitionAt;
      release();

      const responses = await Promise.all([
        origin,
        waiter,
        secondOrigin,
        secondWaiter,
      ]);
      const expectedText = after?.headline ?? "Empty ad slot";
      expect(responses.every(({ html }) => html.includes(expectedText))).toBe(
        true
      );
      if (before) {
        expect(
          responses.every(({ html }) => !html.includes(before.headline))
        ).toBe(true);
      }
      expect(runtime.load).toHaveBeenCalledTimes(2);
      expect(secondRuntime.load).toHaveBeenCalledTimes(2);
      expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(8);
      expect(secondRuntime.resolveAdServingState).toHaveBeenCalledTimes(8);
      expect(
        [runtime, secondRuntime].every(({ resolveAdServingState }) =>
          resolveAdServingState.mock.calls
            .slice(2)
            .every(([, observedAt]) => observedAt === transitionAt)
        )
      ).toBe(true);
      expect(
        [runtime, secondRuntime].every(({ load }) =>
          load.mock.calls.every(
            ([request]) =>
              request.fixedClock.toISOString() === "2026-07-28T12:00:00.000Z"
          )
        )
      ).toBe(true);
      const events = [runtime, secondRuntime].flatMap(({ telemetry }) =>
        telemetry.mock.calls
          .map(([event]) => event)
          .filter(({ event }) => event === "ssr_document")
      );
      expect(events).toHaveLength(4);
      expect(
        events.every(
          ({ adResolutionCount, adRetryCount, adValidationOutcome }) =>
            adResolutionCount === 4 &&
            adRetryCount === 1 &&
            adValidationOutcome === "changed"
        )
      ).toBe(true);
      expect(events.map(({ renderCount }) => renderCount).sort()).toEqual([
        0, 0, 2, 2,
      ]);
    }
  );

  it("fails immediately on serving-state errors and caps changed-state attempts", async () => {
    const preErrorState = {
      current: creative("A"),
      errorAt: 1,
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const preError = createHomeRuntime({ servingState: preErrorState });
    const preErrorResponse = await preError.run("https://ferry.fyi/");
    expect(preErrorResponse).toMatchObject({ status: 503 });
    expect(preErrorResponse.html).not.toContain("private database detail");
    expect(JSON.stringify(preError.telemetry.mock.calls)).not.toContain(
      "private database detail"
    );
    expect(preError.resolveAdServingState).toHaveBeenCalledOnce();
    expect(preError.load).not.toHaveBeenCalled();

    const finalErrorState = {
      current: creative("A"),
      errorAt: 2,
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const finalError = createHomeRuntime({ servingState: finalErrorState });
    await expect(finalError.run("https://ferry.fyi/")).resolves.toMatchObject({
      status: 503,
    });
    expect(finalError.resolveAdServingState).toHaveBeenCalledTimes(2);
    expect(finalError.load).toHaveBeenCalledOnce();
    expect(finalError.cache.sizes.dynamic).toBe(0);

    const churnState = {
      current: creative("A"),
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const churn = createHomeRuntime({ servingState: churnState });
    churn.resolveAdServingState.mockImplementation(async (placementKey) => {
      churnState.reads += 1;
      const current = creative(churnState.reads % 2 ? "A" : "B");
      return {
        creative: current,
        fingerprint: getPublicAdServingFingerprint(placementKey, current),
        placementKey,
      };
    });
    await expect(churn.run("https://ferry.fyi/")).resolves.toMatchObject({
      status: 503,
    });
    expect(churn.resolveAdServingState).toHaveBeenCalledTimes(6);
    expect(churn.load).toHaveBeenCalledTimes(3);
    expect(churn.cache.sizes.dynamic).toBe(0);
    const churnEvent = churn.telemetry.mock.calls
      .map(([event]) => event)
      .find(({ event }) => event === "ssr_document");
    expect(churnEvent).toMatchObject({
      adResolutionCount: 6,
      adRetryCount: 2,
      adValidationOutcome: "changed",
    });
  });

  it("propagates a shared final-validation outage without waiter requery", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((done) => (release = done));
    const servingState = {
      current: creative("A"),
      errorAt: 3,
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const runtime = createHomeRuntime({
      blockFirstLoad: blocked,
      servingState,
    });

    const origin = runtime.run("https://ferry.fyi/");
    await vi.waitFor(() => expect(runtime.load).toHaveBeenCalledOnce());
    const waiter = runtime.run("https://ferry.fyi/");
    await vi.waitFor(() =>
      expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(2)
    );
    release();
    const responses = await Promise.all([origin, waiter]);

    expect(responses.every(({ status }) => status === 503)).toBe(true);
    expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(3);
    const events = runtime.telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document");
    expect(events).toHaveLength(2);
    expect(
      events.every(
        ({ adRetryCount, adValidationOutcome }) =>
          adRetryCount === 0 && adValidationOutcome === "error"
      )
    ).toBe(true);
  });

  it("observes ad mutations independently in two runtime caches", async () => {
    const servingState = {
      current: creative("A"),
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const first = createHomeRuntime({ servingState });
    const second = createHomeRuntime({ servingState });

    await Promise.all([
      first.run("https://ferry.fyi/"),
      second.run("https://ferry.fyi/"),
    ]);
    servingState.current = creative("B");
    servingState.now = new Date("2026-07-28T12:05:00.000Z");
    const responses = await Promise.all([
      first.run("https://ferry.fyi/"),
      second.run("https://ferry.fyi/"),
    ]);

    expect(responses.every(({ html }) => html.includes("Headline B"))).toBe(
      true
    );
    expect(first.load).toHaveBeenCalledTimes(2);
    expect(second.load).toHaveBeenCalledTimes(2);
    expect(first.cache.sizes.dynamic).toBe(1);
    expect(second.cache.sizes.dynamic).toBe(1);
  });

  it("returns but does not commit a stable ad fill that crosses a refresh window", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((done) => (release = done));
    const servingState = {
      current: creative("stable"),
      now: new Date("2026-07-28T21:59:59.999Z"),
      reads: 0,
    };
    const runtime = createHomeRuntime({
      blockFirstLoad: blocked,
      clock: () => servingState.now,
      servingState,
    });

    const first = runtime.run("https://ferry.fyi/");
    await vi.waitFor(() => expect(runtime.load).toHaveBeenCalledOnce());
    // eslint-disable-next-line require-atomic-updates -- advance fixture time while the fill is intentionally pending
    servingState.now = new Date("2026-07-28T22:00:00.000Z");
    release();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(runtime.run("https://ferry.fyi/")).resolves.toMatchObject({
      status: 200,
    });

    expect(runtime.load).toHaveBeenCalledTimes(2);
    expect(runtime.cache.sizes.dynamic).toBe(1);
    const events = runtime.telemetry.mock.calls
      .map(([event]) => event)
      .filter(({ event }) => event === "ssr_document");
    expect(events).toMatchObject([
      { adRetryCount: 0, cacheOutcome: "miss" },
      { adRetryCount: 0, cacheOutcome: "miss" },
    ]);
  });

  it("final-validates ad output while persistence is disabled", async () => {
    const servingState = {
      current: creative("temporary"),
      now: new Date("2026-07-28T12:00:00.000Z"),
      reads: 0,
    };
    const runtime = createHomeRuntime({
      cacheEnabled: false,
      servingState,
    });

    await expect(runtime.run("https://ferry.fyi/")).resolves.toMatchObject({
      status: 200,
    });

    expect(runtime.resolveAdServingState).toHaveBeenCalledTimes(2);
    expect(runtime.cache.sizes.dynamic).toBe(0);
    const event = runtime.telemetry.mock.calls
      .map(([value]) => value)
      .find(({ event }) => event === "ssr_document");
    expect(event).toMatchObject({
      adResolutionCount: 2,
      cacheOutcome: "cache_bypassed",
      controlReason: "cache_bypassed",
    });
  });
});
