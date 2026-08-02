export type SsrHostProfile = "ferry.fyi" | "howmanyboats.today";
export type SsrDocumentKind = "dynamic" | "static";
export type SsrCacheOutcome =
  | "cache_bypassed"
  | "coalesced"
  | "failed"
  | "hit"
  | "miss";
export type SsrCacheFailure = "capacity" | "load";

/** Input is already route-validated and query-normalized by the SSR boundary. */
export interface SsrDocumentCacheKey {
  readonly canonicalPath: string;
  readonly hostProfile: SsrHostProfile;
  readonly kind: SsrDocumentKind;
  readonly normalizedQuery: string;
  readonly serviceDayId?: string;
}

export interface SsrDocumentCacheOptions {
  maxDynamicEntries?: number;
  maxInFlight?: number;
  maxStaticEntries?: number;
}

export interface SsrDocumentCacheRequest<T> {
  readonly cacheEnabled: boolean;
  /** Disabled SSR never invokes a fill or shares a document. */
  readonly enabled: boolean;
  readonly key: SsrDocumentCacheKey;
  readonly load: () => Promise<T>;
  /** Prevents a completed fill from being persisted after its result is known. */
  readonly mayCommit?: (document: T) => boolean;
  /** Rejects a persisted document that is no longer fresh enough to reuse. */
  readonly mayReuse?: (document: T) => boolean;
}

export interface SsrDocumentCacheResult<T> {
  readonly document?: T;
  /** Present only for failed outcomes; never expose loader errors to callers. */
  readonly failure?: SsrCacheFailure;
  readonly outcome: SsrCacheOutcome;
}

interface InFlight<T> {
  readonly generation: number;
  readonly promise: Promise<T>;
}

const keyString = (key: SsrDocumentCacheKey): string =>
  [
    key.kind,
    key.hostProfile,
    key.canonicalPath,
    key.normalizedQuery,
    key.kind === "dynamic" ? (key.serviceDayId ?? "") : "",
  ].join("\u0000");

const assertKey = (key: SsrDocumentCacheKey): void => {
  if (
    (key.hostProfile !== "ferry.fyi" &&
      key.hostProfile !== "howmanyboats.today") ||
    !key.canonicalPath.startsWith("/") ||
    (key.kind === "dynamic" && !key.serviceDayId)
  ) {
    throw new Error("Invalid normalized SSR document cache key");
  }
};

const positive = (value: number | undefined, fallback: number): number =>
  Number.isInteger(value) && value! > 0 ? value! : fallback;

/**
 * Bounded, process-local document cache. Cache reads/writes are optional;
 * in-flight sharing remains available while cache persistence is disabled.
 */
export class SsrDocumentCache<T> {
  #dynamic = new Map<string, T>();
  #generation = 0;
  #inFlight = new Map<string, InFlight<T>>();
  #static = new Map<string, T>();
  readonly #maxDynamicEntries: number;
  readonly #maxInFlight: number;
  readonly #maxStaticEntries: number;

  constructor(options: SsrDocumentCacheOptions = {}) {
    this.#maxDynamicEntries = positive(options.maxDynamicEntries, 128);
    this.#maxInFlight = positive(options.maxInFlight, 64);
    this.#maxStaticEntries = positive(options.maxStaticEntries, 128);
  }

  /**
   * Begins a new runtime/config session. Old waiters may finish, but no longer
   * share, commit, or clean up a new session's in-flight work.
   */
  beginSession(): void {
    this.#generation += 1;
    this.#static.clear();
    this.#dynamic.clear();
    this.#inFlight.clear();
  }

  invalidate(): void {
    this.beginSession();
  }

  pruneDynamic(serviceDayId: string): void {
    for (const key of this.#dynamic.keys()) {
      if (!key.endsWith(`\u0000${serviceDayId}`)) {
        this.#dynamic.delete(key);
      }
    }
  }

  get sizes(): Readonly<{ dynamic: number; inFlight: number; static: number }> {
    return {
      dynamic: this.#dynamic.size,
      inFlight: this.#inFlight.size,
      static: this.#static.size,
    };
  }

  async getOrCreate(
    request: SsrDocumentCacheRequest<T>
  ): Promise<SsrDocumentCacheResult<T>> {
    if (!request.enabled) {
      return { outcome: "cache_bypassed" };
    }
    assertKey(request.key);
    const key = keyString(request.key);
    const cache = request.key.kind === "dynamic" ? this.#dynamic : this.#static;
    if (request.cacheEnabled) {
      const cached = cache.get(key);
      if (cached !== undefined) {
        if (request.mayReuse?.(cached) ?? true) {
          return { document: cached, outcome: "hit" };
        }
        cache.delete(key);
      }
    }
    const existing = this.#inFlight.get(key);
    if (existing) {
      try {
        return { document: await existing.promise, outcome: "coalesced" };
      } catch {
        return { failure: "load", outcome: "failed" };
      }
    }
    // Never launch unbounded unique work; existing keys above may still join.
    if (this.#inFlight.size >= this.#maxInFlight) {
      return { failure: "capacity", outcome: "failed" };
    }
    const generation = this.#generation;
    let fill: Promise<T>;
    try {
      fill = request.load();
    } catch {
      return { failure: "load", outcome: "failed" };
    }
    const inFlight: InFlight<T> = { generation, promise: fill };
    this.#inFlight.set(key, inFlight);
    try {
      const document = await fill;
      if (
        request.cacheEnabled &&
        generation === this.#generation &&
        (request.mayCommit?.(document) ?? true)
      ) {
        if (request.key.kind === "dynamic") {
          this.pruneDynamic(request.key.serviceDayId ?? "");
        }
        cache.set(key, document);
        this.bound(
          cache,
          request.key.kind === "dynamic"
            ? this.#maxDynamicEntries
            : this.#maxStaticEntries
        );
      }
      return {
        document,
        outcome: request.cacheEnabled ? "miss" : "cache_bypassed",
      };
    } catch {
      return { failure: "load", outcome: "failed" };
    } finally {
      if (this.#inFlight.get(key) === inFlight) {
        this.#inFlight.delete(key);
      }
    }
  }

  private bound(cache: Map<string, T>, maximum: number): void {
    while (cache.size > maximum) {
      cache.delete(cache.keys().next().value!);
    }
  }
}
