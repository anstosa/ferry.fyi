/* eslint-disable require-await -- cache loader callbacks intentionally model async I/O. */
import { describe, expect, it } from "vitest";

import {
  SsrDocumentCache,
  type SsrDocumentCacheKey,
} from "../../server/ssr/documentCache";

const staticKey = (
  overrides: Partial<SsrDocumentCacheKey> = {}
): SsrDocumentCacheKey => ({
  canonicalPath: "/about",
  hostProfile: "ferry.fyi",
  kind: "static",
  normalizedQuery: "",
  ...overrides,
});
const dynamicKey = (
  refreshWindowId = "2026-07-28T03:00",
  adFingerprint?: string
): SsrDocumentCacheKey => ({
  ...(adFingerprint ? { adFingerprint } : {}),
  canonicalPath: "/today",
  hostProfile: "ferry.fyi",
  kind: "dynamic",
  normalizedQuery: "",
  refreshWindowId,
});
const request = <T>(key: SsrDocumentCacheKey, load: () => Promise<T>) => ({
  cacheEnabled: true,
  enabled: true,
  key,
  load,
});

describe("SSR document cache", () => {
  it("keeps static and dynamic entries distinct across host and normalized query", async () => {
    const cache = new SsrDocumentCache<string>();
    await cache.getOrCreate(request(staticKey(), async () => "static"));
    await cache.getOrCreate(request(dynamicKey(), async () => "dynamic"));
    await cache.getOrCreate(
      request(
        staticKey({ hostProfile: "howmanyboats.today" }),
        async () => "host"
      )
    );
    await cache.getOrCreate(
      request(
        staticKey({ normalizedQuery: "date=2026-07-28" }),
        async () => "query"
      )
    );

    await expect(
      cache.getOrCreate(request(staticKey(), async () => "wrong"))
    ).resolves.toMatchObject({ document: "static", outcome: "hit" });
    expect(cache.sizes).toEqual({ dynamic: 1, inFlight: 0, static: 3 });
  });

  it("coalesces identical fills and retries after failure", async () => {
    const cache = new SsrDocumentCache<string>();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => (resolve = done));
    const first = cache.getOrCreate(request(staticKey(), () => pending));
    const second = cache.getOrCreate(request(staticKey(), () => pending));
    resolve("ready");
    await expect(first).resolves.toMatchObject({
      document: "ready",
      outcome: "miss",
    });
    await expect(second).resolves.toMatchObject({
      document: "ready",
      outcome: "coalesced",
    });
    await expect(
      cache.getOrCreate(
        request(staticKey({ canonicalPath: "/x" }), async () => {
          throw new Error("no");
        })
      )
    ).resolves.toEqual({ failure: "load", outcome: "failed" });
    let reject!: (error: Error) => void;
    const rejected = new Promise<string>((_resolve, fail) => (reject = fail));
    const failedFirst = cache.getOrCreate(
      request(
        staticKey({ canonicalPath: "/coalesced-failure" }),
        () => rejected
      )
    );
    const failedWaiter = cache.getOrCreate(
      request(
        staticKey({ canonicalPath: "/coalesced-failure" }),
        () => rejected
      )
    );
    reject(new Error("private loader detail"));
    await expect(failedFirst).resolves.toEqual({
      failure: "load",
      outcome: "failed",
    });
    await expect(failedWaiter).resolves.toEqual({
      failure: "load",
      outcome: "failed",
    });
    await expect(
      cache.getOrCreate(
        request(staticKey({ canonicalPath: "/x" }), async () => "retry")
      )
    ).resolves.toMatchObject({ document: "retry", outcome: "miss" });
  });

  // refresh fixed-window documents by identity
  it("reloads a persisted document when its refresh window changes", async () => {
    const cache = new SsrDocumentCache<string>();
    const first = await cache.getOrCreate(
      request(dynamicKey(), async () => "first")
    );
    expect(first).toMatchObject({ document: "first", outcome: "miss" });
    await expect(
      cache.getOrCreate(request(dynamicKey(), async () => "wrong"))
    ).resolves.toMatchObject({ document: "first", outcome: "hit" });

    await expect(
      cache.getOrCreate(
        request(dynamicKey("2026-07-28T15:00"), async () => "fresh")
      )
    ).resolves.toMatchObject({ document: "fresh", outcome: "miss" });
    expect(cache.sizes.dynamic).toBe(1);
  });

  it("bypasses successful persistence while still coalescing cache-disabled work", async () => {
    const cache = new SsrDocumentCache<string>();
    await cache.getOrCreate(request(staticKey(), async () => "old-success"));
    cache.beginSession();
    expect(cache.sizes.static).toBe(0);
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => (resolve = done));
    const options = {
      cacheEnabled: false,
      enabled: true,
      key: staticKey(),
      load: () => pending,
    };
    const first = cache.getOrCreate(options);
    const second = cache.getOrCreate(options);
    resolve("temporary");
    await expect(first).resolves.toMatchObject({ outcome: "cache_bypassed" });
    await expect(second).resolves.toMatchObject({
      document: "temporary",
      outcome: "coalesced",
    });
    expect(cache.sizes.static).toBe(0);
    let disabledCalled = false;
    await expect(
      cache.getOrCreate({
        ...options,
        enabled: false,
        load: async () => {
          disabledCalled = true;
          return "never";
        },
      })
    ).resolves.toEqual({ outcome: "cache_bypassed" });
    expect(disabledCalled).toBe(false);
  });

  it("uses only the pre-normalized safe query key and bounds in-flight sharing", async () => {
    const cache = new SsrDocumentCache<string>({ maxInFlight: 1 });
    let resolve!: (value: string) => void;
    const first = cache.getOrCreate(
      request(
        staticKey({ normalizedQuery: "fareAdults=2" }),
        () => new Promise<string>((done) => (resolve = done))
      )
    );
    let overflowCalled = false;
    const overflow = await cache.getOrCreate(
      request(staticKey({ canonicalPath: "/fares" }), async () => {
        overflowCalled = true;
        return "unshared";
      })
    );
    expect(overflow).toEqual({ failure: "capacity", outcome: "failed" });
    expect(overflowCalled).toBe(false);
    resolve("safe-query");
    await first;
    await expect(
      cache.getOrCreate(
        request(
          staticKey({ normalizedQuery: "fareAdults=2" }),
          async () => "wrong"
        )
      )
    ).resolves.toMatchObject({ document: "safe-query", outcome: "hit" });
  });

  // preserve asynchronous commit eligibility and session invalidation
  it("does not commit rejected candidates or fills after invalidation", async () => {
    const cache = new SsrDocumentCache<string>();
    let current = true;
    await expect(
      cache.getOrCreate({
        ...request(dynamicKey(), async () => "old"),
        // persist only the current candidate
        validate: async (document) => ({
          kind: "validated-candidate",
          mayCommit: current && document === "old",
        }),
      })
    ).resolves.toMatchObject({ document: "old" });
    current = false;
    await expect(
      cache.getOrCreate({
        ...request(dynamicKey("2026-07-28T15:00"), async () => "crossed"),
        // return boundary-crossing bytes without retaining them
        validate: async () => ({
          kind: "validated-candidate",
          mayCommit: current,
        }),
      })
    ).resolves.toMatchObject({ document: "crossed" });
    expect(cache.sizes.dynamic).toBe(1);
    await expect(
      cache.getOrCreate(
        request(dynamicKey("2026-07-28T15:00"), async () => "fresh")
      )
    ).resolves.toMatchObject({ document: "fresh", outcome: "miss" });
    let resolve!: (value: string) => void;
    const fill = cache.getOrCreate(
      request(
        staticKey(),
        () => new Promise<string>((done) => (resolve = done))
      )
    );
    const waiter = cache.getOrCreate(
      request(staticKey(), async () => "should-not-run")
    );
    cache.beginSession();
    resolve("stale");
    await expect(fill).resolves.toMatchObject({ document: "stale" });
    await expect(waiter).resolves.toMatchObject({
      document: "stale",
      outcome: "coalesced",
    });
    expect(cache.sizes.static).toBe(0);
  });

  it("does not attach a new session to an old same-key fill", async () => {
    const cache = new SsrDocumentCache<string>();
    let resolveOld!: (value: string) => void;
    const old = cache.getOrCreate(
      request(
        staticKey(),
        () => new Promise<string>((done) => (resolveOld = done))
      )
    );
    cache.beginSession();
    let resolveNew!: (value: string) => void;
    const fresh = cache.getOrCreate(
      request(
        staticKey(),
        () => new Promise<string>((done) => (resolveNew = done))
      )
    );
    resolveOld("old");
    await expect(old).resolves.toMatchObject({ document: "old" });
    expect(cache.sizes.inFlight).toBe(1);
    resolveNew("new");
    await expect(fresh).resolves.toMatchObject({
      document: "new",
      outcome: "miss",
    });
    await expect(
      cache.getOrCreate(request(staticKey(), async () => "wrong"))
    ).resolves.toMatchObject({ document: "new", outcome: "hit" });
  });

  it("prunes stale dynamic windows and bounds retained work", async () => {
    const cache = new SsrDocumentCache<string>({
      maxDynamicEntries: 1,
      maxInFlight: 1,
      maxStaticEntries: 1,
    });
    await cache.getOrCreate(
      request(dynamicKey("2026-07-27T15:00"), async () => "old")
    );
    await cache.getOrCreate(
      request(dynamicKey("2026-07-28T03:00"), async () => "current")
    );
    await cache.getOrCreate(request(staticKey(), async () => "a"));
    await cache.getOrCreate(
      request(staticKey({ canonicalPath: "/privacy" }), async () => "b")
    );
    expect(cache.sizes).toEqual({ dynamic: 1, inFlight: 0, static: 1 });
  });

  it("validates shared fills before commit and validates every waiter after waiting", async () => {
    const cache = new SsrDocumentCache<string>();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => (resolve = done));
    let state = "A";
    const validate = async () =>
      state === "A"
        ? ({ kind: "validated-candidate", mayCommit: true } as const)
        : ({ kind: "invalidated" } as const);
    const first = cache.getOrCreate({
      ...request(dynamicKey(), () => pending),
      validate,
    });
    const waiter = cache.getOrCreate({
      ...request(dynamicKey(), () => pending),
      validate,
    });

    state = "B";
    resolve("stale-A");

    await expect(first).resolves.toEqual({
      failure: "invalidated",
      outcome: "failed",
    });
    await expect(waiter).resolves.toEqual({
      failure: "invalidated",
      outcome: "failed",
    });
    expect(cache.sizes.dynamic).toBe(0);
  });

  it("keeps fingerprint-specific fills separate and blocks a late stale commit", async () => {
    const cache = new SsrDocumentCache<string>();
    let resolveA!: (value: string) => void;
    let stateAIsCurrent = true;
    const loadA = cache.getOrCreate({
      ...request(
        dynamicKey("2026-07-28T03:00", "fingerprint-A"),
        () => new Promise<string>((done) => (resolveA = done))
      ),
      validate: async () =>
        stateAIsCurrent
          ? { kind: "validated-candidate", mayCommit: true }
          : { kind: "invalidated" },
    });
    const loadB = cache.getOrCreate(
      request(
        dynamicKey("2026-07-28T03:00", "fingerprint-B"),
        async () => "document-B"
      )
    );

    await expect(loadB).resolves.toMatchObject({
      document: "document-B",
      outcome: "miss",
    });
    stateAIsCurrent = false;
    resolveA("document-A");
    await expect(loadA).resolves.toEqual({
      failure: "invalidated",
      outcome: "failed",
    });
    await expect(
      cache.getOrCreate(
        request(
          dynamicKey("2026-07-28T03:00", "fingerprint-B"),
          async () => "wrong"
        )
      )
    ).resolves.toMatchObject({ document: "document-B", outcome: "hit" });
    expect(cache.sizes.dynamic).toBe(1);
  });

  it("does not requery a waiter after a shared validation error", async () => {
    const cache = new SsrDocumentCache<string>();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => (resolve = done));
    const originValidation = async () =>
      ({ kind: "validation-error" }) as const;
    let waiterValidations = 0;
    const origin = cache.getOrCreate({
      ...request(dynamicKey(), () => pending),
      validate: originValidation,
    });
    const waiter = cache.getOrCreate({
      ...request(dynamicKey(), () => pending),
      validate: async () => {
        waiterValidations += 1;
        return { kind: "validated-candidate", mayCommit: true };
      },
    });

    resolve("candidate");
    await expect(origin).resolves.toEqual({
      failure: "validation",
      outcome: "failed",
    });
    await expect(waiter).resolves.toEqual({
      failure: "validation",
      outcome: "failed",
    });
    expect(waiterValidations).toBe(0);
  });

  it("prunes obsolete variants without evicting unrelated placements", async () => {
    const cache = new SsrDocumentCache<string>();
    await cache.getOrCreate(
      request(dynamicKey("2026-07-28T03:00", "home-A"), async () => "home-A")
    );
    const otherKey = {
      ...dynamicKey("2026-07-28T03:00", "fare-X"),
      canonicalPath: "/clinton/fare",
    };
    await cache.getOrCreate(request(otherKey, async () => "fare-X"));
    await cache.getOrCreate(
      request(dynamicKey("2026-07-28T03:00", "home-B"), async () => "home-B")
    );

    await expect(
      cache.getOrCreate(request(otherKey, async () => "wrong"))
    ).resolves.toMatchObject({ document: "fare-X", outcome: "hit" });
    expect(cache.sizes.dynamic).toBe(2);
  });
});
