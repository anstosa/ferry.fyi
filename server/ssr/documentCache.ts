export type SsrHostProfile = "ferry.fyi" | "howmanyboats.today";
export type SsrDocumentKind = "dynamic" | "static";
export type SsrCacheOutcome =
  | "cache_bypassed"
  | "coalesced"
  | "failed"
  | "hit"
  | "miss";
export type SsrCacheFailure =
  | "capacity"
  | "invalidated"
  | "load"
  | "validation";

export type SsrCandidateValidation =
  | Readonly<{ kind: "invalidated" }>
  | Readonly<{ kind: "validated-candidate"; mayCommit: boolean }>
  | Readonly<{ kind: "validation-error" }>;

/** Input is already route-validated and query-normalized by the SSR boundary. */
export interface SsrDocumentCacheKey {
  readonly canonicalPath: string;
  readonly hostProfile: SsrHostProfile;
  readonly kind: SsrDocumentKind;
  readonly normalizedQuery: string;
  readonly adFingerprint?: string;
  readonly refreshWindowId?: string;
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
  /** Validates shared async work before commit/return and once per waiter. */
  readonly validate?: (document?: T) => Promise<SsrCandidateValidation>;
}

export interface SsrDocumentCacheResult<T> {
  readonly document?: T;
  /** Present only for failed outcomes; never expose loader errors to callers. */
  readonly failure?: SsrCacheFailure;
  readonly outcome: SsrCacheOutcome;
}

type InFlightResult<T> =
  | Readonly<{ document: T; kind: "validated-candidate"; mayCommit: boolean }>
  | Readonly<{ kind: "invalidated" }>
  | Readonly<{ kind: "load-error" }>
  | Readonly<{ kind: "validation-error" }>;

interface InFlight<T> {
  readonly promise: Promise<InFlightResult<T>>;
}

const keyString = (key: SsrDocumentCacheKey): string =>
  [
    key.kind,
    key.hostProfile,
    key.canonicalPath,
    key.normalizedQuery,
    key.kind === "dynamic" ? (key.refreshWindowId ?? "") : "",
    key.kind === "dynamic" ? (key.adFingerprint ?? "") : "",
  ].join("\u0000");

const assertKey = (key: SsrDocumentCacheKey): void => {
  if (
    (key.hostProfile !== "ferry.fyi" &&
      key.hostProfile !== "howmanyboats.today") ||
    !key.canonicalPath.startsWith("/") ||
    (key.kind === "dynamic" && !key.refreshWindowId)
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

  pruneDynamic(current: SsrDocumentCacheKey): void {
    const currentKey = keyString(current);
    const currentParts = currentKey.split("\u0000");
    const currentBase = currentParts.slice(0, 4).join("\u0000");
    for (const key of this.#dynamic.keys()) {
      const parts = key.split("\u0000");
      const base = parts.slice(0, 4).join("\u0000");
      // discard documents from prior fixed refresh windows
      if (parts[4] !== current.refreshWindowId) {
        this.#dynamic.delete(key);
      } else if (base === currentBase && key !== currentKey) {
        // retain only the current ad variant for this route identity
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
    // reuse documents within their validated cache identity
    if (request.cacheEnabled) {
      const cached = cache.get(key);
      // return retained documents directly
      if (cached !== undefined) {
        return { document: cached, outcome: "hit" };
      }
    }
    const existing = this.#inFlight.get(key);
    if (existing) {
      const shared = await existing.promise;
      // keep validation errors distinct from loader errors
      if (shared.kind === "load-error") {
        return { failure: "load", outcome: "failed" };
      }
      // propagate a known validation outage without another database read
      if (shared.kind === "validation-error") {
        return { failure: "validation", outcome: "failed" };
      }
      let waiterValidation: SsrCandidateValidation | undefined;
      // revalidate every coalesced caller after waiting
      if (request.validate) {
        try {
          waiterValidation = await request.validate(
            shared.kind === "validated-candidate" ? shared.document : undefined
          );
        } catch {
          waiterValidation = { kind: "validation-error" };
        }
      }
      if (waiterValidation?.kind === "validation-error") {
        return { failure: "validation", outcome: "failed" };
      }
      if (
        shared.kind === "invalidated" ||
        waiterValidation?.kind === "invalidated"
      ) {
        return { failure: "invalidated", outcome: "failed" };
      }
      return { document: shared.document, outcome: "coalesced" };
    }
    // Never launch unbounded unique work; existing keys above may still join.
    if (this.#inFlight.size >= this.#maxInFlight) {
      return { failure: "capacity", outcome: "failed" };
    }
    const generation = this.#generation;
    const fill = this.loadAndValidate(request);
    const inFlight: InFlight<T> = { promise: fill };
    this.#inFlight.set(key, inFlight);
    try {
      const result = await fill;
      // fail closed without exposing rejected candidate bytes
      if (result.kind === "load-error") {
        return { failure: "load", outcome: "failed" };
      }
      if (result.kind === "validation-error") {
        return { failure: "validation", outcome: "failed" };
      }
      if (result.kind === "invalidated") {
        return { failure: "invalidated", outcome: "failed" };
      }
      const { document } = result;
      // retain only validated candidates from the current session
      if (
        request.cacheEnabled &&
        generation === this.#generation &&
        result.mayCommit
      ) {
        if (request.key.kind === "dynamic") {
          this.pruneDynamic(request.key);
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
    } finally {
      if (this.#inFlight.get(key) === inFlight) {
        this.#inFlight.delete(key);
      }
    }
  }

  // include asynchronous candidate validation in shared in-flight work
  private async loadAndValidate(
    request: SsrDocumentCacheRequest<T>
  ): Promise<InFlightResult<T>> {
    let document: T;
    try {
      document = await request.load();
    } catch {
      return { kind: "load-error" };
    }
    if (!request.validate) {
      return { document, kind: "validated-candidate", mayCommit: true };
    }
    let validation: SsrCandidateValidation;
    try {
      validation = await request.validate(document);
    } catch {
      return { kind: "validation-error" };
    }
    return validation.kind === "validated-candidate"
      ? { document, kind: validation.kind, mayCommit: validation.mayCommit }
      : validation;
  }

  private bound(cache: Map<string, T>, maximum: number): void {
    while (cache.size > maximum) {
      cache.delete(cache.keys().next().value!);
    }
  }
}
