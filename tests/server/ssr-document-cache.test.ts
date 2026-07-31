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
const dynamicKey = (serviceDayId = "2026-07-28"): SsrDocumentCacheKey => ({
  canonicalPath: "/today",
  hostProfile: "ferry.fyi",
  kind: "dynamic",
  normalizedQuery: "",
  serviceDayId,
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

  it("does not commit fills after a service-day boundary or invalidation", async () => {
    const cache = new SsrDocumentCache<string>();
    let current = true;
    await expect(
      cache.getOrCreate({
        ...request(dynamicKey(), async () => "old"),
        mayCommit: () => current,
      })
    ).resolves.toMatchObject({ document: "old" });
    current = false;
    await expect(
      cache.getOrCreate({
        ...request(dynamicKey("2026-07-29"), async () => "crossed"),
        mayCommit: () => current,
      })
    ).resolves.toMatchObject({ document: "crossed" });
    expect(cache.sizes.dynamic).toBe(1);
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

  it("prunes stale dynamic days and bounds retained work", async () => {
    const cache = new SsrDocumentCache<string>({
      maxDynamicEntries: 1,
      maxInFlight: 1,
      maxStaticEntries: 1,
    });
    await cache.getOrCreate(
      request(dynamicKey("2026-07-27"), async () => "old")
    );
    await cache.getOrCreate(
      request(dynamicKey("2026-07-28"), async () => "current")
    );
    await cache.getOrCreate(request(staticKey(), async () => "a"));
    await cache.getOrCreate(
      request(staticKey({ canonicalPath: "/privacy" }), async () => "b")
    );
    expect(cache.sizes).toEqual({ dynamic: 1, inFlight: 0, static: 1 });
  });
});
