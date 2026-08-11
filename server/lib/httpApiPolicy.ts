import cors from "cors";
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { rateLimit } from "express-rate-limit";

import { getWsfStatus } from "./wsf/api";

export type ApiRouteClass =
  | "ad-measurement"
  | "anonymous-read"
  | "authenticated"
  | "ota"
  | "sensitive-lookup"
  | "upstream-refresh";

export const API_RATE_LIMITS = Object.freeze({
  "ad-measurement": {
    limitEnv: "API_AD_MEASUREMENT_LIMIT",
    limit: 240,
    windowMs: 60_000,
  },
  "anonymous-read": {
    limitEnv: "API_ANONYMOUS_READ_LIMIT",
    limit: 600,
    windowMs: 60_000,
  },
  "sensitive-lookup": {
    limitEnv: "API_SENSITIVE_LOOKUP_LIMIT",
    limit: 30,
    windowMs: 60_000,
  },
  "upstream-refresh": {
    limitEnv: "API_UPSTREAM_REFRESH_LIMIT",
    limit: 10,
    windowMs: 60_000,
  },
});

const asPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const pathnameFor = (request: Pick<Request, "originalUrl" | "path">) => {
  const source = request.originalUrl || request.path;
  return source.split("?", 1)[0].replace(/^\/api(?=\/|$)/, "") || "/";
};

export const classifyApiRequest = ({
  method,
  pathname,
}: {
  method: string;
  pathname: string;
}): ApiRouteClass => {
  const normalizedMethod = method.toUpperCase();
  const path = pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  if (path === "/ota" || path.startsWith("/ota/")) {
    return "ota";
  }
  if (
    (path === "/vessels/refresh" || path === "/terminals/bulletins/refresh") &&
    normalizedMethod === "POST"
  ) {
    return "upstream-refresh";
  }
  if (path === "/tickets" || path.startsWith("/tickets/")) {
    return "sensitive-lookup";
  }
  if (path === "/ios-migration" || path.startsWith("/ios-migration/")) {
    return "sensitive-lookup";
  }
  // destructive account action
  if (path === "/user" && normalizedMethod === "DELETE") {
    return "sensitive-lookup";
  }
  if (path === "/ads" || path.startsWith("/ads/")) {
    return normalizedMethod === "GET" || normalizedMethod === "HEAD"
      ? "anonymous-read"
      : "ad-measurement";
  }
  if (path === "/ad-reports" || path.startsWith("/ad-reports/")) {
    return "sensitive-lookup";
  }
  if (
    path === "/user" ||
    path.startsWith("/user/") ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/features/me" ||
    path.startsWith("/leaderboards/checkins/") ||
    path.startsWith("/leaderboards/preferences") ||
    path === "/leaderboards/account"
  ) {
    return "authenticated";
  }
  if (
    new Set(["GET", "HEAD", "POST", "OPTIONS"]).has(normalizedMethod) &&
    [
      "/cameras",
      "/fares",
      "/features",
      "/leaderboards",
      "/schedule",
      "/terminals",
      "/vessels",
    ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  ) {
    return "anonymous-read";
  }
  return "authenticated";
};

const trustedOrigins = (): Set<string> => {
  const values = [
    process.env.BASE_URL,
    ...(process.env.TRUSTED_API_ORIGINS ?? "").split(","),
  ];
  return new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        try {
          return [new URL(value).origin];
        } catch {
          return [];
        }
      })
  );
};

const API_CLIENT_ERRORS = new Map<number, string>([
  [400, "invalid_request"],
  [413, "payload_too_large"],
  [415, "unsupported_media_type"],
]);

const requestOrigin = (request: Request): string =>
  `${request.protocol}://${request.get("host")}`;

export const createApiCorsMiddleware = (): RequestHandler => {
  const middleware = cors((request, callback) => {
    const typedRequest = request as Request;
    const routeClass = classifyApiRequest({
      method: typedRequest.method,
      pathname: pathnameFor(typedRequest),
    });
    if (routeClass === "anonymous-read" || routeClass === "ota") {
      callback(null, {
        credentials: false,
        methods: ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"],
        origin: "*",
      });
      return;
    }
    const origin = typedRequest.get("origin");
    const allowed =
      !origin ||
      origin === requestOrigin(typedRequest) ||
      trustedOrigins().has(origin);
    callback(null, {
      credentials: false,
      methods: ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"],
      origin: allowed ? (origin ?? false) : false,
    });
  });
  return (request, response, next) => middleware(request, response, next);
};

const createLimiter = (
  routeClass: keyof typeof API_RATE_LIMITS
): RequestHandler => {
  const policy = API_RATE_LIMITS[routeClass];
  return rateLimit({
    identifier: routeClass,
    legacyHeaders: false,
    limit: asPositiveInteger(process.env[policy.limitEnv], policy.limit),
    standardHeaders: "draft-8",
    windowMs: policy.windowMs,
    handler: (request, response) => {
      sendApiError(request, response, 429, "rate_limited");
    },
  });
};

export const createApiRateLimitMiddleware = (): RequestHandler => {
  const limiters = {
    "ad-measurement": createLimiter("ad-measurement"),
    "anonymous-read": createLimiter("anonymous-read"),
    "sensitive-lookup": createLimiter("sensitive-lookup"),
    "upstream-refresh": createLimiter("upstream-refresh"),
  };
  return (request, response, next) => {
    const routeClass = classifyApiRequest({
      method: request.method,
      pathname: pathnameFor(request),
    });
    if (routeClass in limiters) {
      limiters[routeClass as keyof typeof limiters](request, response, next);
      return;
    }
    next();
  };
};

export const applyApiErrorHeaders = (response: Response): void => {
  response.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive",
  });
  response.type("application/json");
};

// detect the canonical API envelope
const isWrappedApiBody = (body: unknown): boolean => {
  // envelope guard
  return (
    body !== null &&
    typeof body === "object" &&
    "wsfStatus" in body &&
    "body" in body
  );
};

// add ferry status to one API body
const wrapApiBody = (body: unknown): unknown => {
  // duplicate envelope guard
  if (isWrappedApiBody(body)) {
    return body;
  }
  return {
    wsfStatus: getWsfStatus(),
    body,
  };
};

// wrap ordinary API responses
export const wrapApiResponse: RequestHandler = (request, response, next) => {
  const defaultSend = response.send;
  const sendJson = (body: unknown): Response => {
    response.type("application/json");
    return defaultSend.call(response, JSON.stringify(wrapApiBody(body)));
  };
  const wrapJson: (typeof response)["json"] = (body) => sendJson(body);
  const wrapSend: (typeof response)["send"] = (body) => {
    // empty status guard
    if (typeof body === "undefined") {
      if (response.statusCode === 404) {
        applyApiErrorHeaders(response);
        return sendJson({ error: "resource_not_found" });
      }
      return defaultSend.call(response, body);
    }
    if (response.statusCode >= 400) {
      applyApiErrorHeaders(response);
    }
    return sendJson(body);
  };
  response.json = wrapJson;
  response.send = wrapSend;
  next();
};

const sendApiError = (
  request: Request,
  response: Response,
  status: number,
  error: string
): void => {
  applyApiErrorHeaders(response);
  const body = { error };
  if (
    classifyApiRequest({
      method: request.method,
      pathname: pathnameFor(request),
    }) === "ota"
  ) {
    response.status(status).send(body);
    return;
  }
  response.status(status).send({ body, wsfStatus: getWsfStatus() });
};

export const apiNotFound: RequestHandler = (request, response) => {
  sendApiError(request, response, 404, "api_not_found");
};

const statusForError = (error: unknown): number => {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status;
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number") {
    return status;
  }
  return typeof statusCode === "number" ? statusCode : 500;
};

export const apiErrorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  // Express recognizes error middleware by its four-parameter signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next
) => {
  const status = statusForError(error);
  const unauthorized = status === 401;
  const clientError = API_CLIENT_ERRORS.get(status);
  const challenge =
    (error as { headers?: Record<string, unknown> })?.headers?.[
      "WWW-Authenticate"
    ] ??
    (error as { headers?: Record<string, unknown> })?.headers?.[
      "www-authenticate"
    ];
  if (unauthorized && typeof challenge === "string") {
    response.set("WWW-Authenticate", challenge);
  }
  if (unauthorized) {
    sendApiError(request, response, 401, "unauthorized");
    return;
  }
  sendApiError(
    request,
    response,
    clientError ? status : 500,
    clientError ?? "internal_error"
  );
};

export const denyUntrustedSensitivePreflight: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  if (request.method !== "OPTIONS" || !request.get("origin")) {
    next();
    return;
  }
  const routeClass = classifyApiRequest({
    method: request.get("access-control-request-method") ?? request.method,
    pathname: pathnameFor(request),
  });
  const origin = request.get("origin") as string;
  if (
    routeClass !== "anonymous-read" &&
    routeClass !== "ota" &&
    origin !== requestOrigin(request) &&
    !trustedOrigins().has(origin)
  ) {
    sendApiError(request, response, 403, "origin_not_allowed");
    return;
  }
  next();
};
