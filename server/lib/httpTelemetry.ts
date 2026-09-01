import type { Request, RequestHandler } from "express";

import logger from "~/lib/logger";

import { classifyApiRequest } from "./httpApiPolicy";

export const HTTP_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type HttpMethodClass = "other" | "preflight" | "read" | "write";
export type HttpRouteClass =
  | "api.ad-measurement"
  | "api.anonymous-read"
  | "api.automatic-native"
  | "api.authenticated"
  | "api.ota"
  | "api.sensitive-lookup"
  | "api.upstream-refresh"
  | "asset"
  | "discovery"
  | "health"
  | "other"
  | "readiness"
  | "ssr.public";
export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "429";
export type HttpCompletionOutcome = "completed" | "failed" | "incomplete";

export interface HttpTelemetryEvent {
  completionOutcome: HttpCompletionOutcome;
  durationMs: number;
  event: "public_http_request";
  methodClass: HttpMethodClass;
  release: string;
  routeClass: HttpRouteClass;
  schemaVersion: typeof HTTP_TELEMETRY_SCHEMA_VERSION;
  statusClass: HttpStatusClass;
}

export type HttpTelemetrySink = (event: HttpTelemetryEvent) => void;

const EVENT_KEYS = new Set([
  "completionOutcome",
  "durationMs",
  "event",
  "methodClass",
  "release",
  "routeClass",
  "schemaVersion",
  "statusClass",
]);
const METHOD_CLASSES = new Set<HttpMethodClass>([
  "other",
  "preflight",
  "read",
  "write",
]);
const ROUTE_CLASSES = new Set<HttpRouteClass>([
  "api.ad-measurement",
  "api.anonymous-read",
  "api.automatic-native",
  "api.authenticated",
  "api.ota",
  "api.sensitive-lookup",
  "api.upstream-refresh",
  "asset",
  "discovery",
  "health",
  "other",
  "readiness",
  "ssr.public",
]);
const STATUS_CLASSES = new Set<HttpStatusClass>([
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "429",
]);
const COMPLETION_OUTCOMES = new Set<HttpCompletionOutcome>([
  "completed",
  "failed",
  "incomplete",
]);

const pathnameFor = (request: Pick<Request, "originalUrl" | "path">): string =>
  (request.originalUrl || request.path).split(/[?#]/, 1)[0] || "/";

// classify requests without inspecting sensitive content
export const classifyHttpRoute = (
  request: Pick<Request, "method" | "originalUrl" | "path">
): HttpRouteClass => {
  const pathname = pathnameFor(request);
  // classify health checks
  if (pathname === "/healthz") {
    return "health";
  }
  // classify readiness checks
  if (pathname === "/readyz") {
    return "readiness";
  }
  // classify discovery documents
  if (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt" ||
    pathname === "/openapi.json" ||
    pathname === "/.well-known/security.txt"
  ) {
    return "discovery";
  }
  // classify api traffic
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return `api.${classifyApiRequest({
      method: request.method,
      pathname,
    })}`;
  }
  // classify static assets
  if (/\.[a-z0-9]{2,8}$/i.test(pathname)) {
    return "asset";
  }
  // classify public reads
  if (request.method === "GET" || request.method === "HEAD") {
    return "ssr.public";
  }
  return "other";
};

export const classifyHttpMethod = (method: string): HttpMethodClass => {
  const normalized = method.toUpperCase();
  if (normalized === "OPTIONS") {
    return "preflight";
  }
  if (normalized === "GET" || normalized === "HEAD") {
    return "read";
  }
  if (new Set(["DELETE", "PATCH", "POST", "PUT"]).has(normalized)) {
    return "write";
  }
  return "other";
};

export const classifyHttpStatus = (status: number): HttpStatusClass => {
  if (status === 429) {
    return "429";
  }
  if (status >= 500) {
    return "5xx";
  }
  if (status >= 400) {
    return "4xx";
  }
  if (status >= 300) {
    return "3xx";
  }
  if (status >= 200) {
    return "2xx";
  }
  return "1xx";
};

export const normalizeRelease = (value: string | undefined): string =>
  value && /^[a-z0-9._-]{1,80}$/i.test(value) ? value : "unknown";

export const validateHttpTelemetryEvent = (
  value: unknown
): HttpTelemetryEvent => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("HTTP telemetry event must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!EVENT_KEYS.has(key)) {
      throw new Error(`HTTP telemetry field is not allowed: ${key}`);
    }
  }
  if (
    record.schemaVersion !== HTTP_TELEMETRY_SCHEMA_VERSION ||
    record.event !== "public_http_request" ||
    !METHOD_CLASSES.has(record.methodClass as HttpMethodClass) ||
    !ROUTE_CLASSES.has(record.routeClass as HttpRouteClass) ||
    !STATUS_CLASSES.has(record.statusClass as HttpStatusClass) ||
    !COMPLETION_OUTCOMES.has(
      record.completionOutcome as HttpCompletionOutcome
    ) ||
    typeof record.durationMs !== "number" ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0 ||
    typeof record.release !== "string" ||
    normalizeRelease(record.release) !== record.release
  ) {
    throw new Error("HTTP telemetry event is invalid");
  }
  return record as unknown as HttpTelemetryEvent;
};

export const reportHttpTelemetry: HttpTelemetrySink = (event) => {
  logger.info("Public HTTP telemetry", validateHttpTelemetryEvent(event));
};

export const createHttpTelemetryMiddleware =
  ({
    now = () => process.hrtime.bigint(),
    release = normalizeRelease(
      process.env.RELEASE_VERSION ??
        process.env.SOURCE_VERSION ??
        process.env.GITHUB_SHA
    ),
    sink = reportHttpTelemetry,
  }: {
    now?: () => bigint;
    release?: string;
    sink?: HttpTelemetrySink;
  } = {}): RequestHandler =>
  (request, response, next) => {
    const startedAt = now();
    let emitted = false;
    const emit = (completionOutcome: HttpCompletionOutcome): void => {
      if (emitted) {
        return;
      }
      emitted = true;
      const elapsed = Number(now() - startedAt) / 1_000_000;
      sink({
        completionOutcome,
        durationMs: Math.max(0, Math.round(elapsed * 1000) / 1000),
        event: "public_http_request",
        methodClass: classifyHttpMethod(request.method),
        release: normalizeRelease(release),
        routeClass: classifyHttpRoute(request),
        schemaVersion: HTTP_TELEMETRY_SCHEMA_VERSION,
        statusClass: classifyHttpStatus(response.statusCode),
      });
    };
    response.once("finish", () =>
      emit(response.statusCode >= 500 ? "failed" : "completed")
    );
    response.once("close", () => emit("incomplete"));
    response.once("error", () => emit("failed"));
    next();
  };
