import type {
  PublicSsrRenderDocumentResult,
  PublicSsrRendererArtifact,
} from "shared/contracts/ssrRenderer";
import { assemblePublicSsrMarkerDocument } from "shared/lib/ssrDocumentTemplate";
import { publicQueryCacheKey } from "shared/lib/ssrQueryPolicy";
import {
  getPublicSsrHostProfile,
  type PublicSsrRouteMatch,
} from "shared/lib/ssrRouteMatch";
import {
  getNextSsrSailingDayBoundary,
  getSsrSailingDayId,
} from "shared/lib/ssrSailingDay";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

import type { SsrConfig } from "./config";
import type {
  SsrCacheOutcome,
  SsrDocumentCache,
  SsrDocumentCacheKey,
} from "./documentCache";
import type { PublicSsrLoadResult } from "./publicSnapshot";

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
      routeId?: string;
      safeQuery?: string;
      controlReason?: "cache_bypassed" | "ssr_disabled";
      completedAt?: number;
      renderedAt?: number;
      release?: string;
      sailingDayId?: string;
    }>
  | Readonly<{
      cacheEnabled: boolean;
      documentsEnabled: boolean;
      event: "ssr_startup";
    }>;

export interface SsrDocumentRuntimeDependencies {
  readonly cache: SsrDocumentCache<SsrRuntimeFill>;
  readonly clock: () => Date;
  readonly config: SsrConfig;
  readonly contentRevision: () => string;
  readonly load: (input: {
    absoluteUrl: string;
    contentRevision: string;
    fixedClock: Date;
    release: { publishedAt: string | null; version: string };
  }) => Promise<PublicSsrLoadResult>;
  readonly resolve: (
    url: URL,
    options?: { pureOnly?: boolean }
  ) => Promise<
    | { classification: "eligible"; match: PublicSsrRouteMatch }
    | { classification: "private"; match: PublicSsrRouteMatch }
    | {
        classification: "redirect";
        match: PublicSsrRouteMatch;
        redirectTo: string;
      }
    | { classification: "unknown" }
  >;
  readonly release: () => { publishedAt: string | null; version: string };
  /** The sole production renderer is the validated ESM artifact. */
  readonly renderer: PublicSsrRendererArtifact;
  readonly telemetry?: (event: SsrTelemetryEvent) => void;
  readonly template: string;
}

export type SsrRuntimeFill = {
  completedAt: number;
  renderedAt: number;
  result: PublicSsrRenderDocumentResult;
};

export interface SsrDocumentResponse {
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect?: string;
  readonly status: 200 | 301 | 404 | 503;
}

const documentHeaders = {
  "Cache-Control": "no-store, no-transform",
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
  dependencies.cache.beginSession();
  dependencies.telemetry?.({
    cacheEnabled: dependencies.config.cacheEnabled,
    documentsEnabled: dependencies.config.enabled,
    event: "ssr_startup",
  });
  const emit = (
    event: Omit<
      Extract<SsrTelemetryEvent, { event: "ssr_document" }>,
      "durationMs" | "event"
    >,
    started: number
  ) =>
    dependencies.telemetry?.({
      ...event,
      durationMs: Math.max(0, dependencies.clock().getTime() - started),
      event: "ssr_document",
    });

  return async (absoluteUrl: string): Promise<SsrDocumentResponse> => {
    const started = dependencies.clock().getTime();
    const url = new URL(absoluteUrl);
    const host = getPublicSsrHostProfile(url.hostname);
    if (!host) {
      emit({ category: "unknown" }, started);
      return {
        html: noindex(dependencies.template, "private"),
        headers: noindexHeaders,
        status: 404,
      };
    }
    let resolved: Awaited<
      ReturnType<SsrDocumentRuntimeDependencies["resolve"]>
    >;
    try {
      resolved = await dependencies.resolve(url, {
        pureOnly: !dependencies.config.enabled,
      });
    } catch {
      emit({ category: "failure", errorClass: "loader" }, started);
      return failureResponse(dependencies.template);
    }
    if (resolved.classification === "unknown") {
      emit({ category: "unknown" }, started);
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
      emit({ ...safe, category: "callback" }, started);
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
      emit({ ...safe, category: "private" }, started);
      return {
        html: noindex(dependencies.template, "private"),
        headers: noindexHeaders,
        status: 200,
      };
    }
    if (resolved.classification === "redirect") {
      emit({ ...safe, category: "redirect" }, started);
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
        const loaded = await dependencies.load({
          absoluteUrl: canonicalUrl.toString(),
          contentRevision: dependencies.contentRevision(),
          fixedClock: now,
          release,
        });
        if (
          loaded.classification !== "snapshot" ||
          !sameRouteMatch(match, loaded.match)
        ) {
          errorClass = "integrity";
          throw new Error("SSR not-found loader identity mismatch");
        }
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
        let result;
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
        }
        emit(
          {
            ...safe,
            canonicalPath: "/404",
            category: "not-found",
            completedAt: now.getTime(),
            release: release.version,
            renderedAt: now.getTime(),
          },
          started
        );
        return { html: result.html, headers: noindexHeaders, status: 404 };
      } catch {
        emit(
          {
            ...safe,
            canonicalPath: "/404",
            category: "failure",
            errorClass,
            release: release.version,
          },
          started
        );
        return failureResponse(dependencies.template);
      }
    }
    if (!dependencies.config.enabled) {
      emit(
        { ...safe, category: "disabled", controlReason: "ssr_disabled" },
        started
      );
      return {
        html: noindex(dependencies.template, "disabled"),
        headers: noindexHeaders,
        status: 200,
      };
    }
    if (match.route.kind !== "static" && match.route.kind !== "dynamic") {
      emit({ ...safe, category: "failure", errorClass: "loader" }, started);
      return failureResponse(dependencies.template);
    }
    const now = dependencies.clock();
    const release = dependencies.release();
    const sailingDayId =
      match.route.kind === "dynamic" ? getSsrSailingDayId(now) : undefined;
    const key: SsrDocumentCacheKey = {
      canonicalPath: match.canonicalPath,
      hostProfile: host,
      kind: match.route.kind,
      normalizedQuery: publicQueryCacheKey(match.query),
      serviceDayId: sailingDayId,
    };
    let failureClass: Extract<
      SsrTelemetryEvent,
      { event: "ssr_document" }
    >["errorClass"] = "unknown";
    const cached = await dependencies.cache.getOrCreate({
      cacheEnabled: dependencies.config.cacheEnabled,
      enabled: true,
      key,
      load: async () => {
        const safeQuery = publicQueryCacheKey(match.query);
        const canonicalUrl = new URL(match.canonicalPath, url.origin);
        canonicalUrl.search = safeQuery;
        let loaded: PublicSsrLoadResult;
        try {
          loaded = await dependencies.load({
            absoluteUrl: canonicalUrl.toString(),
            contentRevision: dependencies.contentRevision(),
            fixedClock: now,
            release,
          });
        } catch (error) {
          failureClass = "loader";
          throw error;
        }
        if (loaded.classification !== "snapshot") {
          failureClass = "loader";
          throw new Error("SSR loader did not return a public snapshot");
        }
        let snapshot;
        try {
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
        }
        try {
          const result = await renderSnapshotDocument(dependencies, {
            now,
            requestUrl: canonicalUrl.toString(),
            seoBaseUrl: url.origin,
            seoHost: host,
            seoPathname: snapshot.canonicalPath,
            snapshot,
          });
          return {
            completedAt: dependencies.clock().getTime(),
            renderedAt: now.getTime(),
            result,
          };
        } catch (error) {
          failureClass = "render";
          throw error;
        }
      },
      mayCommit: () =>
        match.route.kind === "static" ||
        dependencies.clock() < getNextSsrSailingDayBoundary(now),
    });
    if (!cached.document) {
      emit(
        {
          ...safe,
          category: "failure",
          cacheOutcome: cached.outcome,
          errorClass: cached.failure === "capacity" ? "capacity" : failureClass,
          controlReason: dependencies.config.cacheEnabled
            ? undefined
            : "cache_bypassed",
          sailingDayId,
          release: release.version,
        },
        started
      );
      return failureResponse(dependencies.template);
    }
    emit(
      {
        ...safe,
        category: "snapshot",
        cacheOutcome: cached.outcome,
        completedAt: cached.document.completedAt,
        controlReason: dependencies.config.cacheEnabled
          ? undefined
          : "cache_bypassed",
        renderedAt: cached.document.renderedAt,
        sailingDayId,
        release: release.version,
      },
      started
    );
    return {
      html: cached.document.result.html,
      headers: documentHeaders,
      status: 200,
    };
  };
};
