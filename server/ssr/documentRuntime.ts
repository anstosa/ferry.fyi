import type {
  PublicSsrRenderDocumentResult,
  PublicSsrRendererArtifact,
} from "shared/contracts/ssrRenderer";
import type { PublicSsrSourceKey } from "shared/contracts/ssrRouting";
import {
  getPublicSsrAdPlacementBinding,
  type PublicSsrAdPlacementBinding,
  type PublicSsrAdServingBinding,
} from "shared/lib/ssrAdPlacement";
import { assemblePublicSsrMarkerDocument } from "shared/lib/ssrDocumentTemplate";
import { publicQueryCacheKey } from "shared/lib/ssrQueryPolicy";
import { getSsrRefreshWindow } from "shared/lib/ssrRefreshWindow";
import {
  getPublicSsrHostProfile,
  type PublicSsrRouteMatch,
} from "shared/lib/ssrRouteMatch";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

import type { SsrConfig } from "./config";
import type {
  SsrCacheOutcome,
  SsrDocumentCache,
  SsrDocumentCacheKey,
} from "./documentCache";
import {
  type PublicSsrCanonicalResolution,
  PublicSsrIntegrityFailure,
  type PublicSsrLoadResult,
} from "./publicSnapshot";

export type SsrTelemetryEvent =
  | Readonly<{
      cacheOutcome?: SsrCacheOutcome;
      canonicalHost?: "ferry.fyi" | "howmanyboats.today";
      canonicalPath?: string;
      category:
        | "callback"
        | "disabled"
        | "failure"
        | "not-found"
        | "private"
        | "redirect"
        | "snapshot"
        | "unknown";
      durationMs: number;
      errorClass?: "capacity" | "integrity" | "loader" | "render" | "unknown";
      event: "ssr_document";
      phases: Readonly<{
        cache: number;
        render: number;
        routeResolve: number;
        snapshotLoad: number;
        snapshotValidation: number;
        sourceGroups: Readonly<Partial<Record<PublicSsrSourceKey, number>>>;
        total: number;
        unit: "milliseconds";
      }>;
      routeId?: string;
      safeQuery?: string;
      controlReason?: "cache_bypassed" | "ssr_disabled";
      completedAt?: number;
      renderedAt?: number;
      release?: string;
      adResolutionCount?: number;
      adRetryCount?: number;
      adValidationDurationMs?: number;
      adValidationOutcome?: "changed" | "error" | "not-applicable" | "stable";
      refreshWindowClass?: "03:00" | "15:00";
      refreshWindowId?: string;
      renderCount?: number;
      snapshotLoadCount?: number;
    }>
  | Readonly<{
      cacheEnabled: boolean;
      documentsEnabled: boolean;
      event: "ssr_startup";
    }>;

export type SsrAdServingState = Readonly<
  Pick<PublicSsrAdServingBinding, "creative" | "fingerprint" | "placementKey">
>;

export interface SsrDocumentRuntimeDependencies {
  readonly cache: SsrDocumentCache<SsrRuntimeFill>;
  readonly clock: () => Date;
  readonly config: SsrConfig;
  readonly contentRevision: () => string;
  readonly load: (input: {
    absoluteUrl: string;
    adServingBinding?: PublicSsrAdServingBinding;
    contentRevision: string;
    fixedClock: Date;
    release: { publishedAt: string | null; version: string };
  }) => Promise<PublicSsrLoadResult>;
  readonly monotonicClock?: () => number;
  readonly resolve: (
    url: URL,
    options?: { pureOnly?: boolean }
  ) => Promise<PublicSsrCanonicalResolution>;
  readonly resolveAdServingState?: (
    placementKey: string,
    now: Date
  ) => Promise<SsrAdServingState>;
  readonly release: () => { publishedAt: string | null; version: string };
  /** The sole production renderer is the validated ESM artifact. */
  readonly renderer: PublicSsrRendererArtifact;
  readonly telemetry?: (event: SsrTelemetryEvent) => void;
  readonly template: string;
  readonly servingClock?: () => Date;
}

export type SsrRuntimeFill = {
  cacheable: boolean;
  completedAt: number;
  renderedAt: number;
  result: PublicSsrRenderDocumentResult;
};

export const isPublicSsrDocumentCacheable = (snapshot: {
  sources: Readonly<Record<string, unknown>>;
}): boolean =>
  !Object.values(snapshot.sources).some(
    (source) =>
      typeof source === "object" &&
      source !== null &&
      "outcome" in source &&
      source.outcome === "transiently-unavailable"
  );

export interface SsrDocumentResponse {
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect?: string;
  readonly status: 200 | 301 | 404 | 503;
}

const documentHeaders = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Surrogate-Control": "no-store",
  Vary: "Host",
} as const;
const noindexHeaders = {
  ...documentHeaders,
  "X-Robots-Tag": "noindex, noarchive",
} as const;

const noindex = (
  template: string,
  mode: "callback" | "disabled" | "failure" | "private"
) => assemblePublicSsrMarkerDocument(template, mode);

function failureResponse(template: string): SsrDocumentResponse {
  return {
    html: noindex(template, "failure"),
    headers: { ...noindexHeaders, "Retry-After": "30" },
    status: 503,
  };
}

const renderSnapshotDocument = (
  dependencies: SsrDocumentRuntimeDependencies,
  input: {
    now: Date;
    requestUrl: string;
    seoBaseUrl: string;
    seoHost: string;
    seoPathname: string;
    snapshot: unknown;
  }
): Promise<PublicSsrRenderDocumentResult> =>
  dependencies.renderer.renderPublicSsrDocument({
    renderedAt: input.now.getTime(),
    requestUrl: input.requestUrl,
    seoBaseUrl: input.seoBaseUrl,
    seoHost: input.seoHost,
    seoPathname: input.seoPathname,
    snapshot: input.snapshot,
    template: dependencies.template,
  });

const publicRouteParamKeys = [
  "terminalSlug",
  "mateSlug",
  "terminalId",
  "vesselId",
] as const;

const sameRouteMatch = (
  expected: PublicSsrRouteMatch,
  actual: PublicSsrRouteMatch
) =>
  expected.canonicalPath === actual.canonicalPath &&
  expected.routePath === actual.routePath &&
  expected.route.id === actual.route.id &&
  expected.route.kind === actual.route.kind &&
  expected.route.path === actual.route.path &&
  publicQueryCacheKey(expected.query) === publicQueryCacheKey(actual.query) &&
  publicRouteParamKeys.every(
    (key) => expected.params[key] === actual.params[key]
  );

const expectedSnapshotCanonicalPath = (
  host: "ferry.fyi" | "howmanyboats.today",
  match: PublicSsrRouteMatch
): string =>
  host === "howmanyboats.today" && match.route.id === "today"
    ? "/"
    : match.canonicalPath;

/** A pure, injected SSR orchestration boundary; production artifact loading stays outside it. */
export const createSsrDocumentRuntime = (
  dependencies: SsrDocumentRuntimeDependencies
) => {
  const monotonicClock =
    dependencies.monotonicClock ?? (() => performance.now());
  dependencies.cache.beginSession();
  dependencies.telemetry?.({
    cacheEnabled: dependencies.config.cacheEnabled,
    documentsEnabled: dependencies.config.enabled,
    event: "ssr_startup",
  });
  const emit = (
    event: Omit<
      Extract<SsrTelemetryEvent, { event: "ssr_document" }>,
      "durationMs" | "event" | "phases"
    >,
    started: number,
    phases: Extract<SsrTelemetryEvent, { event: "ssr_document" }>["phases"]
  ) =>
    dependencies.telemetry?.({
      ...event,
      durationMs: Math.max(0, dependencies.clock().getTime() - started),
      event: "ssr_document",
      phases,
    });

  return async (absoluteUrl: string): Promise<SsrDocumentResponse> => {
    const started = dependencies.clock().getTime();
    const monotonicStarted = monotonicClock();
    const phaseValues = {
      cache: 0,
      render: 0,
      routeResolve: 0,
      snapshotLoad: 0,
      snapshotValidation: 0,
      sourceGroups: {} as Partial<Record<PublicSsrSourceKey, number>>,
    };
    const phases = () => ({
      ...phaseValues,
      sourceGroups: { ...phaseValues.sourceGroups },
      total: Math.max(0, monotonicClock() - monotonicStarted),
      unit: "milliseconds" as const,
    });
    const emitRequest = (
      event: Omit<
        Extract<SsrTelemetryEvent, { event: "ssr_document" }>,
        "durationMs" | "event" | "phases"
      >
    ) => emit(event, started, phases());
    const url = new URL(absoluteUrl);
    const host = getPublicSsrHostProfile(url.hostname);
    if (!host) {
      emitRequest({ category: "unknown" });
      return {
        html: noindex(dependencies.template, "private"),
        headers: noindexHeaders,
        status: 404,
      };
    }
    let resolved: Awaited<
      ReturnType<SsrDocumentRuntimeDependencies["resolve"]>
    >;
    const resolveStarted = monotonicClock();
    try {
      resolved = await dependencies.resolve(url, {
        pureOnly: !dependencies.config.enabled,
      });
    } catch {
      phaseValues.routeResolve = Math.max(0, monotonicClock() - resolveStarted);
      emitRequest({ category: "failure", errorClass: "loader" });
      return failureResponse(dependencies.template);
    }
    phaseValues.routeResolve = Math.max(0, monotonicClock() - resolveStarted);
    if (resolved.classification === "unknown") {
      emitRequest({ category: "unknown" });
      return {
        html: noindex(dependencies.template, "private"),
        headers: noindexHeaders,
        status: 404,
      };
    }
    const { match } = resolved;
    const safe = {
      canonicalHost: host,
      canonicalPath: match.canonicalPath,
      routeId: match.route.id,
      safeQuery: publicQueryCacheKey(match.query),
    };
    if (match.route.id === "callback") {
      emitRequest({ ...safe, category: "callback" });
      return {
        html: noindex(dependencies.template, "callback"),
        headers: noindexHeaders,
        status: 200,
      };
    }
    if (
      resolved.classification === "private" ||
      match.route.kind === "private"
    ) {
      emitRequest({ ...safe, category: "private" });
      return {
        html: noindex(dependencies.template, "private"),
        headers: noindexHeaders,
        status: 200,
      };
    }
    if (resolved.classification === "redirect") {
      emitRequest({ ...safe, category: "redirect" });
      return {
        html: "",
        headers: noindexHeaders,
        redirect: resolved.redirectTo,
        status: 301,
      };
    }
    if (match.route.kind === "not-found") {
      const release = dependencies.release();
      const canonicalUrl = new URL("/404", url.origin);
      const now = dependencies.clock();
      let errorClass: Extract<
        SsrTelemetryEvent,
        { event: "ssr_document" }
      >["errorClass"] = "loader";
      let snapshot;
      try {
        const loadStarted = monotonicClock();
        let loaded: PublicSsrLoadResult;
        try {
          loaded = await dependencies.load({
            absoluteUrl: canonicalUrl.toString(),
            contentRevision: dependencies.contentRevision(),
            fixedClock: now,
            release,
          });
        } finally {
          phaseValues.snapshotLoad = Math.max(
            0,
            monotonicClock() - loadStarted
          );
        }
        const validationStarted = monotonicClock();
        try {
          if (
            loaded.classification !== "snapshot" ||
            !sameRouteMatch(match, loaded.match)
          ) {
            errorClass = "integrity";
            throw new Error("SSR not-found loader identity mismatch");
          }
          phaseValues.sourceGroups = { ...(loaded.sourceDurationsMs ?? {}) };
          try {
            snapshot = assertPublicSsrSnapshot(loaded.snapshot);
          } catch (error) {
            errorClass = "integrity";
            throw error;
          }
          if (
            snapshot.canonicalHost !== host ||
            snapshot.hostProfile !== host ||
            snapshot.canonicalPath !== "/404" ||
            snapshot.routeId !== "unknown-public-path" ||
            publicQueryCacheKey({
              rejected: [],
              values: snapshot.normalizedUrl.query,
            }) !== "" ||
            Object.keys(snapshot.routeParams).length !== 0
          ) {
            errorClass = "integrity";
            throw new Error("SSR not-found snapshot identity mismatch");
          }
        } finally {
          phaseValues.snapshotValidation = Math.max(
            0,
            monotonicClock() - validationStarted
          );
        }
        let result;
        const renderStarted = monotonicClock();
        try {
          result = await renderSnapshotDocument(dependencies, {
            now,
            requestUrl: canonicalUrl.toString(),
            seoBaseUrl: url.origin,
            seoHost: host,
            seoPathname: "/404",
            snapshot,
          });
        } catch (error) {
          errorClass = "render";
          throw error;
        } finally {
          phaseValues.render = Math.max(0, monotonicClock() - renderStarted);
        }
        emitRequest({
          ...safe,
          canonicalPath: "/404",
          category: "not-found",
          completedAt: now.getTime(),
          release: release.version,
          renderedAt: now.getTime(),
        });
        return { html: result.html, headers: noindexHeaders, status: 404 };
      } catch {
        emitRequest({
          ...safe,
          canonicalPath: "/404",
          category: "failure",
          errorClass,
          release: release.version,
        });
        return failureResponse(dependencies.template);
      }
    }
    if (!dependencies.config.enabled) {
      emitRequest({
        ...safe,
        category: "disabled",
        controlReason: "ssr_disabled",
      });
      return {
        html: noindex(dependencies.template, "disabled"),
        headers: noindexHeaders,
        status: 200,
      };
    }
    if (match.route.kind !== "static" && match.route.kind !== "dynamic") {
      emitRequest({ ...safe, category: "failure", errorClass: "loader" });
      return failureResponse(dependencies.template);
    }
    const release = dependencies.release();
    const routeHasAd = match.route.requiredSources.includes("ad");
    let { adPlacementBinding } = resolved;
    // derive the seed-free home placement for injected test resolvers
    if (routeHasAd && !adPlacementBinding) {
      try {
        adPlacementBinding = getPublicSsrAdPlacementBinding(match);
      } catch {
        adPlacementBinding = undefined;
      }
    }
    // fail closed when an ad route lacks its canonical placement binding
    if (
      routeHasAd &&
      (!adPlacementBinding || !dependencies.resolveAdServingState)
    ) {
      emitRequest({
        ...safe,
        adResolutionCount: 0,
        adRetryCount: 0,
        adValidationDurationMs: 0,
        adValidationOutcome: "error",
        category: "failure",
        errorClass: "integrity",
        renderCount: 0,
        release: release.version,
        snapshotLoadCount: 0,
      });
      return failureResponse(dependencies.template);
    }
    let failureClass: Extract<
      SsrTelemetryEvent,
      { event: "ssr_document" }
    >["errorClass"] = "unknown";
    let adResolutionCount = 0;
    let adRetryCount = 0;
    let adValidationDurationMs = 0;
    let adValidationOutcome: Extract<
      SsrTelemetryEvent,
      { event: "ssr_document" }
    >["adValidationOutcome"] = routeHasAd ? "stable" : "not-applicable";
    let renderCount = 0;
    let snapshotLoadCount = 0;
    let finalRefreshWindowClass: "03:00" | "15:00" | undefined;
    let finalRefreshWindowId: string | undefined;
    let finalCached:
      | Awaited<ReturnType<SsrDocumentCache<SsrRuntimeFill>["getOrCreate"]>>
      | undefined;
    const servingClock = dependencies.servingClock ?? dependencies.clock;
    const readAdServingBinding = async (
      binding: PublicSsrAdPlacementBinding
    ): Promise<{ binding: PublicSsrAdServingBinding; now: Date }> => {
      const now = servingClock();
      const validationStarted = monotonicClock();
      adResolutionCount += 1;
      try {
        const state = await dependencies.resolveAdServingState!(
          binding.placementKey,
          now
        );
        // reject service decisions for another placement or malformed hash
        if (
          state.placementKey !== binding.placementKey ||
          !/^[a-f0-9]{64}$/u.test(state.fingerprint) ||
          (state.creative !== null &&
            state.creative.placementKey !== binding.placementKey)
        ) {
          throw new PublicSsrIntegrityFailure(
            "Public SSR ad serving state identity mismatch"
          );
        }
        return { binding: { ...binding, ...state }, now };
      } finally {
        adValidationDurationMs += Math.max(
          0,
          monotonicClock() - validationStarted
        );
      }
    };
    const cacheStarted = monotonicClock();
    // retry only effective ad-state changes
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fixedClock = dependencies.clock();
      let servingBinding: PublicSsrAdServingBinding | undefined;
      // observe the authoritative placement state before key selection
      if (adPlacementBinding) {
        try {
          const observed = await readAdServingBinding(adPlacementBinding);
          servingBinding = observed.binding;
        } catch (error) {
          failureClass =
            error instanceof PublicSsrIntegrityFailure ? "integrity" : "loader";
          adValidationOutcome = "error";
          break;
        }
      }
      // bind reuse to the content snapshot rather than ad-serving time
      const refreshWindow =
        match.route.kind === "dynamic"
          ? getSsrRefreshWindow(fixedClock)
          : undefined;
      finalRefreshWindowId = refreshWindow?.id;
      finalRefreshWindowClass = refreshWindow?.classification;
      const key: SsrDocumentCacheKey = {
        canonicalPath: match.canonicalPath,
        hostProfile: host,
        kind: match.route.kind,
        normalizedQuery: publicQueryCacheKey(match.query),
        ...(servingBinding
          ? { adFingerprint: servingBinding.fingerprint }
          : {}),
        ...(refreshWindow ? { refreshWindowId: refreshWindow.id } : {}),
      };
      const cached = await dependencies.cache.getOrCreate({
        cacheEnabled: dependencies.config.cacheEnabled,
        enabled: true,
        key,
        // bind candidate work to this immutable attempt
        // eslint-disable-next-line no-loop-func
        load: async () => {
          const safeQuery = publicQueryCacheKey(match.query);
          const canonicalUrl = new URL(match.canonicalPath, url.origin);
          canonicalUrl.search = safeQuery;
          let loaded: PublicSsrLoadResult;
          const loadStarted = monotonicClock();
          snapshotLoadCount += 1;
          try {
            loaded = await dependencies.load({
              absoluteUrl: canonicalUrl.toString(),
              ...(servingBinding ? { adServingBinding: servingBinding } : {}),
              contentRevision: dependencies.contentRevision(),
              fixedClock,
              release,
            });
            if (loaded.classification === "snapshot") {
              phaseValues.sourceGroups = {
                ...(loaded.sourceDurationsMs ?? {}),
              };
            }
          } catch (error) {
            failureClass =
              error instanceof PublicSsrIntegrityFailure
                ? "integrity"
                : "loader";
            throw error;
          } finally {
            phaseValues.snapshotLoad += Math.max(
              0,
              monotonicClock() - loadStarted
            );
          }
          const validationStarted = monotonicClock();
          let snapshot;
          try {
            if (loaded.classification !== "snapshot") {
              failureClass = "loader";
              throw new Error("SSR loader did not return a public snapshot");
            }
            if (!sameRouteMatch(match, loaded.match)) {
              failureClass = "integrity";
              throw new Error("SSR loader route identity mismatch");
            }
            snapshot = assertPublicSsrSnapshot(loaded.snapshot);
            if (
              snapshot.canonicalHost !== host ||
              snapshot.hostProfile !== host ||
              snapshot.canonicalPath !==
                expectedSnapshotCanonicalPath(host, match) ||
              snapshot.routeId !== match.route.id ||
              publicQueryCacheKey({
                rejected: [],
                values: snapshot.normalizedUrl.query,
              }) !== publicQueryCacheKey(match.query) ||
              JSON.stringify(snapshot.routeParams) !==
                JSON.stringify(match.params)
            ) {
              failureClass = "integrity";
              throw new Error("SSR snapshot identity mismatch");
            }
          } catch (error) {
            if (failureClass !== "integrity") {
              failureClass = "integrity";
            }
            throw error;
          } finally {
            phaseValues.snapshotValidation += Math.max(
              0,
              monotonicClock() - validationStarted
            );
          }
          const renderStarted = monotonicClock();
          renderCount += 1;
          try {
            const result = await renderSnapshotDocument(dependencies, {
              now: fixedClock,
              requestUrl: canonicalUrl.toString(),
              seoBaseUrl: url.origin,
              seoHost: host,
              seoPathname: snapshot.canonicalPath,
              snapshot,
            });
            return {
              cacheable: isPublicSsrDocumentCacheable(snapshot),
              completedAt: dependencies.clock().getTime(),
              renderedAt: fixedClock.getTime(),
              result,
            };
          } catch (error) {
            failureClass = "render";
            throw error;
          } finally {
            phaseValues.render += Math.max(0, monotonicClock() - renderStarted);
          }
        },
        ...(match.route.kind === "dynamic" || servingBinding
          ? {
              // validate against this immutable attempt state
              // eslint-disable-next-line no-loop-func
              validate: async (document?: SsrRuntimeFill) => {
                // validate the effective ad state with a fresh clock sample
                if (adPlacementBinding && servingBinding) {
                  try {
                    const observed =
                      await readAdServingBinding(adPlacementBinding);
                    if (
                      observed.binding.fingerprint !==
                      servingBinding.fingerprint
                    ) {
                      adValidationOutcome = "changed";
                      return { kind: "invalidated" as const };
                    }
                  } catch (error) {
                    failureClass =
                      error instanceof PublicSsrIntegrityFailure
                        ? "integrity"
                        : "loader";
                    adValidationOutcome = "error";
                    return { kind: "validation-error" as const };
                  }
                }
                // reject persistence after a boundary crossed during ad validation
                const currentWindow = getSsrRefreshWindow(dependencies.clock());
                return {
                  kind: "validated-candidate" as const,
                  mayCommit:
                    Boolean(document?.cacheable) &&
                    currentWindow.id === refreshWindow?.id,
                };
              },
            }
          : {}),
      });
      finalCached = cached;
      // classify shared validation outages without another serving-state read
      if (cached.failure === "validation") {
        adValidationOutcome = "error";
        if (failureClass === "unknown") {
          failureClass = "loader";
        }
      }
      // retry only a changed effective ad state
      if (cached.failure === "invalidated" && adPlacementBinding) {
        if (attempt < 2) {
          adRetryCount += 1;
          continue;
        }
      }
      break;
    }
    const cacheDuration = Math.max(0, monotonicClock() - cacheStarted);
    phaseValues.cache = Math.max(
      0,
      cacheDuration -
        phaseValues.snapshotLoad -
        phaseValues.snapshotValidation -
        phaseValues.render
    );
    if (!finalCached?.document) {
      emitRequest({
        ...safe,
        adResolutionCount,
        adRetryCount,
        adValidationDurationMs,
        adValidationOutcome,
        category: "failure",
        cacheOutcome: finalCached?.outcome ?? "failed",
        errorClass:
          finalCached?.failure === "capacity" ? "capacity" : failureClass,
        controlReason: dependencies.config.cacheEnabled
          ? undefined
          : "cache_bypassed",
        refreshWindowId: finalRefreshWindowId,
        refreshWindowClass: finalRefreshWindowClass,
        renderCount,
        release: release.version,
        snapshotLoadCount,
      });
      return failureResponse(dependencies.template);
    }
    emitRequest({
      ...safe,
      adResolutionCount,
      adRetryCount,
      adValidationDurationMs,
      adValidationOutcome,
      category: "snapshot",
      cacheOutcome: finalCached.outcome,
      completedAt: finalCached.document.completedAt,
      controlReason: dependencies.config.cacheEnabled
        ? undefined
        : "cache_bypassed",
      refreshWindowId: finalRefreshWindowId,
      refreshWindowClass: finalRefreshWindowClass,
      renderedAt: finalCached.document.renderedAt,
      renderCount,
      release: release.version,
      snapshotLoadCount,
    });
    return {
      html: finalCached.document.result.html,
      headers: documentHeaders,
      status: 200,
    };
  };
};
