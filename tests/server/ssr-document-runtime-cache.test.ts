/* eslint-disable require-await -- injected loaders deliberately model async service calls. */
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type PublicSsrServerEntry,
  renderPublicSsrDocument,
} from "../../server/ssr/document";
import { SsrDocumentCache } from "../../server/ssr/documentCache";
import {
  createSsrDocumentRuntime,
  type SsrRuntimeFill,
} from "../../server/ssr/documentRuntime";
import {
  createPublicSsrCanonicalResolver,
  createPublicSsrTerminalResolver,
  type PublicSsrLoadResult,
  PublicSsrTransientFailure,
} from "../../server/ssr/publicSnapshot";
import { PUBLIC_SSR_SNAPSHOT_VERSION } from "../../shared/contracts/ssr";
import type { Terminal } from "../../shared/contracts/terminals";
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
});
