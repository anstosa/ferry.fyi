import { describe, expect, it, vi } from "vitest";

import { createServerApp } from "../../client/entry-server";
import {
  type PublicSsrServerEntry,
  renderPublicSsrDocument,
} from "../../server/ssr/document";
import { SsrDocumentCache } from "../../server/ssr/documentCache";
import {
  createSsrDocumentRuntime,
  type SsrDocumentRuntimeDependencies,
  type SsrRuntimeFill,
} from "../../server/ssr/documentRuntime";
import {
  createPublicSsrCanonicalResolver,
  createPublicSsrSnapshotLoader,
} from "../../server/ssr/publicSnapshot";
import type { PublicSsrSnapshot } from "../../shared/contracts/ssr";
import { PUBLIC_SSR_SNAPSHOT_SCRIPT_ID } from "../../shared/contracts/ssrDocument";
import { matchPublicSsrRoute } from "../../shared/lib/ssrRouteMatch";

const template = '<html><head></head><body><div id="root"></div></body></html>';
const match = (url: URL) => {
  return matchPublicSsrRoute(url);
};

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

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("not needed for the About snapshot"));

const loadAboutSnapshot = async (): Promise<PublicSsrSnapshot> => {
  const loadSnapshot = createPublicSsrSnapshotLoader({
    services: {
      getCameraFrames: unavailable,
      getContent: unavailable,
      getFareCatalog: unavailable,
      getLeaderboard: unavailable,
      getPublicLeaderboardsEnabled: unavailable,
      getSchedule: unavailable,
      getTerminals: unavailable,
      getVessels: unavailable,
      getWsfStatus: unavailable,
    },
  });
  const loaded = await loadSnapshot({
    absoluteUrl: "https://ferry.fyi/about",
    contentRevision: "test",
    fixedClock: new Date("2026-07-28T12:00:00.000Z"),
    release: { publishedAt: null, version: "test" },
  });
  if (loaded.classification !== "snapshot") {
    throw new Error("Expected a public About snapshot");
  }
  return loaded.snapshot;
};

const runtime = (overrides: Partial<SsrDocumentRuntimeDependencies> = {}) => {
  const load = vi.fn(() =>
    Promise.resolve({
      classification: "redirect",
      match: match(new URL("https://ferry.fyi/about")),
      redirectTo: "/forecasting",
      snapshot: undefined,
    })
  );
  const telemetry = vi.fn();
  const cache = new SsrDocumentCache<SsrRuntimeFill>();
  const run = createSsrDocumentRuntime({
    cache,
    clock: () => new Date("2026-07-28T12:00:00Z"),
    config: { cacheEnabled: true, enabled: true },
    contentRevision: () => "test",
    renderer: rendererFor({
      createServerApp: () => {
        throw Error("not used");
      },
    }),
    load,
    resolve: (url) => {
      const matched = match(url);
      if (!matched) {
        return Promise.resolve({ classification: "unknown" as const });
      }
      if (matched.route.kind === "private") {
        return Promise.resolve({
          classification: "private" as const,
          match: matched,
        });
      }
      return Promise.resolve({
        classification: "eligible" as const,
        match: matched,
      });
    },
    release: () => ({ publishedAt: null, version: "test" }),
    telemetry,
    template,
    ...overrides,
  });
  return { cache, load, run, telemetry };
};

describe("SSR document runtime", () => {
  it("keeps callback canaries out of marker documents and telemetry", async () => {
    const { load, run, telemetry } = runtime();
    const response = await run(
      "https://ferry.fyi/callback?code=canary&state=secret"
    );
    expect(response.status).toBe(200);
    expect(response.html).not.toContain("canary");
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("canary");
    expect(load).not.toHaveBeenCalled();
    expect(telemetry.mock.calls[0][0]).toEqual({
      cacheEnabled: true,
      documentsEnabled: true,
      event: "ssr_startup",
    });
  });

  it("uses disabled noindex documents without loading", async () => {
    const { load, run } = runtime({
      config: { cacheEnabled: true, enabled: false },
    });
    const response = await run("https://ferry.fyi/about");
    expect(response.status).toBe(200);
    expect(response.html).toContain('data-ferry-fyi-render-mode="disabled"');
    expect(response.headers["X-Robots-Tag"]).toBe("noindex, noarchive");
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps disabled dynamic terminal documents pure when terminal data rejects", async () => {
    const getTerminals = vi.fn(() => Promise.reject(Error("warming")));
    const { cache, load, run } = runtime({
      config: { cacheEnabled: true, enabled: false },
      resolve: createPublicSsrCanonicalResolver({ getTerminals }),
    });
    const getOrCreate = vi.spyOn(cache, "getOrCreate");

    const response = await run("https://ferry.fyi/clinton");

    expect(response.status).toBe(200);
    expect(response.html).toContain('data-ferry-fyi-render-mode="disabled"');
    expect(getTerminals).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(cache.sizes).toEqual({ dynamic: 0, inFlight: 0, static: 0 });
  });

  it.each([
    [
      "canonical path",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        canonicalPath: "/privacy",
      }),
    ],
    [
      "canonical host",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        canonicalHost: "howmanyboats.today" as const,
      }),
    ],
    [
      "host profile",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        hostProfile: "howmanyboats.today" as const,
      }),
    ],
    [
      "safe query",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        normalizedUrl: {
          ...snapshot.normalizedUrl,
          query: { date: "2026-07-29" },
        },
      }),
    ],
    [
      "route params",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        routeParams: { terminalSlug: "clinton" },
      }),
    ],
    [
      "route id",
      (snapshot: PublicSsrSnapshot) => ({
        ...snapshot,
        routeId: "privacy" as const,
      }),
    ],
  ])(
    "rejects a snapshot %s identity mismatch without committing it",
    async (_label, mutate) => {
      const snapshot = await loadAboutSnapshot();
      const loadedMatch = match(new URL("https://ferry.fyi/about"));
      if (!loadedMatch) {
        throw new Error("Expected About route match");
      }
      const load = vi.fn(() =>
        Promise.resolve({
          classification: "snapshot" as const,
          match: loadedMatch,
          snapshot: mutate(snapshot),
        })
      );
      const { cache, run, telemetry } = runtime({ load });

      const first = await run("https://ferry.fyi/about");
      const retry = await run("https://ferry.fyi/about");

      expect(first.status).toBe(503);
      expect(retry.status).toBe(503);
      expect(first.headers["Retry-After"]).toBe("30");
      expect(first.html).not.toContain(PUBLIC_SSR_SNAPSHOT_SCRIPT_ID);
      expect(load).toHaveBeenCalledTimes(2);
      expect(cache.sizes).toEqual({ dynamic: 0, inFlight: 0, static: 0 });
      expect(telemetry.mock.calls.at(-1)?.[0]).toMatchObject({
        cacheOutcome: "failed",
        category: "failure",
        errorClass: "integrity",
      });
    }
  );

  it.each([
    [
      "canonical path",
      (matchValue: ReturnType<typeof match>) => ({
        ...matchValue!,
        canonicalPath: "/privacy",
      }),
    ],
    [
      "route path",
      (matchValue: ReturnType<typeof match>) => ({
        ...matchValue!,
        routePath: "/privacy",
      }),
    ],
    [
      "params",
      (matchValue: ReturnType<typeof match>) => ({
        ...matchValue!,
        params: { ...matchValue!.params, terminalSlug: "clinton" },
      }),
    ],
    [
      "safe query",
      (matchValue: ReturnType<typeof match>) => ({
        ...matchValue!,
        query: { ...matchValue!.query, values: { date: "2026-07-29" } },
      }),
    ],
  ])(
    "rejects a loader %s identity mismatch while its snapshot remains valid",
    async (_label, mutate) => {
      const snapshot = await loadAboutSnapshot();
      const originalMatch = match(new URL("https://ferry.fyi/about"));
      if (!originalMatch) {
        throw new Error("Expected About route match");
      }
      const load = vi.fn(() =>
        Promise.resolve({
          classification: "snapshot" as const,
          match: mutate(originalMatch),
          snapshot,
        })
      );
      const { cache, run, telemetry } = runtime({ load });

      const first = await run("https://ferry.fyi/about");
      const retry = await run("https://ferry.fyi/about");
      expect(first.status).toBe(503);
      expect(retry.status).toBe(503);
      expect(first.headers["Retry-After"]).toBe("30");
      expect(first.html).not.toContain(PUBLIC_SSR_SNAPSHOT_SCRIPT_ID);
      expect(load).toHaveBeenCalledTimes(2);
      expect(cache.sizes).toEqual({ dynamic: 0, inFlight: 0, static: 0 });
      expect(telemetry.mock.calls.at(-1)?.[0]).toMatchObject({
        cacheOutcome: "failed",
        category: "failure",
        errorClass: "integrity",
      });
    }
  );

  it("does not load an already canonical redirect response", async () => {
    const { load, run } = runtime();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => run("https://ferry.fyi/about"))
    );
    expect(responses.every((response) => response.status === 503)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("renders request-neutral uncached 404 documents through the real resolver", async () => {
    const getTerminals = vi.fn(() => Promise.reject(Error("not used")));
    const load = vi.fn(
      createPublicSsrSnapshotLoader({
        services: {
          getCameraFrames: unavailable,
          getContent: unavailable,
          getFareCatalog: unavailable,
          getLeaderboard: unavailable,
          getPublicLeaderboardsEnabled: unavailable,
          getSchedule: unavailable,
          getTerminals,
          getVessels: unavailable,
          getWsfStatus: unavailable,
        },
      })
    );
    const { cache, run, telemetry } = runtime({
      renderer: rendererFor({ createServerApp }),
      load,
      resolve: createPublicSsrCanonicalResolver({ getTerminals }),
    });
    const getOrCreate = vi.spyOn(cache, "getOrCreate");
    const response = await run("https://ferry.fyi/not-real?token=canary");
    const other = await run(
      "https://ferry.fyi/another-private-path?secret=canary"
    );
    expect(response.status).toBe(404);
    expect(other.status).toBe(404);
    expect(response.headers).toMatchObject({
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
      Vary: "Host",
      "X-Robots-Tag": "noindex, noarchive",
    });
    expect(response.html).toContain("Page Not Found - Ferry FYI");
    expect(response.html).toContain('href="https://ferry.fyi/404"');
    expect(response.html).not.toContain("canary");
    expect(other.html).toBe(response.html);
    expect(getTerminals).not.toHaveBeenCalled();
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("canary");
    expect(telemetry.mock.calls.at(-1)?.[0]).toMatchObject({
      canonicalPath: "/404",
      category: "not-found",
      routeId: "unknown-public-path",
    });

    const howmany = await run(
      "https://howmanyboats.today/missing?private=canary"
    );
    expect(howmany.status).toBe(404);
    expect(howmany.redirect).toBeUndefined();
    expect(howmany.html).toContain("Page Not Found - Ferry FYI");
    expect(howmany.html).toContain('href="https://howmanyboats.today/404"');
    expect(howmany.html).toContain('name="robots" content="noindex,follow"');
    expect(howmany.html).not.toContain("How Many Boats?");
  });

  it("returns a retryable marker when a 404 React render fails", async () => {
    const getTerminals = vi.fn(() => Promise.reject(Error("not used")));
    const load = vi.fn(
      createPublicSsrSnapshotLoader({
        services: {
          getCameraFrames: unavailable,
          getContent: unavailable,
          getFareCatalog: unavailable,
          getLeaderboard: unavailable,
          getPublicLeaderboardsEnabled: unavailable,
          getSchedule: unavailable,
          getTerminals,
          getVessels: unavailable,
          getWsfStatus: unavailable,
        },
      })
    );
    const createFailingApp = vi.fn(() => {
      throw Error("render-canary");
    });
    const { cache, run, telemetry } = runtime({
      renderer: rendererFor({ createServerApp: createFailingApp }),
      load,
      resolve: createPublicSsrCanonicalResolver({ getTerminals }),
    });
    const getOrCreate = vi.spyOn(cache, "getOrCreate");

    const first = await run("https://ferry.fyi/not-found?secret=canary");
    const retry = await run("https://ferry.fyi/other-miss?secret=canary");

    for (const response of [first, retry]) {
      expect(response.status).toBe(503);
      expect(response.headers["Retry-After"]).toBe("30");
      expect(response.html).not.toContain(PUBLIC_SSR_SNAPSHOT_SCRIPT_ID);
      expect(response.html).not.toContain("canary");
      expect(response.html).not.toContain("render-canary");
    }
    expect(load).toHaveBeenCalledTimes(2);
    expect(createFailingApp).toHaveBeenCalledTimes(2);
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("canary");
    expect(telemetry.mock.calls.at(-1)?.[0]).toMatchObject({
      canonicalPath: "/404",
      category: "failure",
      errorClass: "render",
    });
  });
});
