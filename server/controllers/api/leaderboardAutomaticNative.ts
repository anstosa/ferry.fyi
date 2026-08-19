import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from "express";
import { QueryTypes } from "sequelize";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_MAX_BODY_BYTES,
  AUTOMATIC_CHECKIN_OUTCOMES,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  type AutomaticCheckinCandidateV1,
  type AutomaticCheckinNativeScope,
  type AutomaticCheckinOutcome,
  type AutomaticCheckinResponseV1,
  type AutomaticNativeConfigV1,
  type AutomaticNativePolicyStatusV1,
  type AutomaticNativeRevokeResultV1,
} from "shared/contracts/leaderboards";
import {
  parseAutomaticCheckinCandidateV1,
  parseAutomaticCheckinResponseV1,
  parseAutomaticNativeConfigV1,
  parseAutomaticNativePolicyStatusV1,
} from "shared/lib/leaderboardAutomaticContracts";

import { db } from "~/lib/db";
import {
  type AutomaticNativeRateLimitClass,
  createAutomaticNativeRateLimitMiddleware,
} from "~/lib/httpApiPolicy";
import {
  AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS,
  createLeaderboardAutomaticCandidateHandler,
} from "~/services/leaderboardAutomaticCandidateReceipts";
import {
  authenticateAutomaticEnrollmentBearer,
  automaticEnrollmentNativeUrls,
  getAuthenticatedAutomaticEnrollmentConfigPolicy,
  getAuthenticatedAutomaticEnrollmentStatus,
  nativeRevokeAutomaticEnrollment,
} from "~/services/leaderboardAutomaticEnrollment";
import { loadCurrentAutomaticTerminalConfig } from "~/services/leaderboardAutomaticNativeConfig";
import {
  AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
  createLeaderboardAutomaticTerminalProofEvaluator,
} from "~/services/leaderboardAutomaticTerminalProof";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/u;

type AutomaticNativeAuthenticationOutcome =
  | "authentication_failed"
  | "enrollment_expired"
  | "enrollment_revoked";

type AutomaticNativeErrorCode =
  | AutomaticCheckinOutcome
  | "https_required"
  | "internal_error"
  | "not_found"
  | "origin_not_allowed";

/** authenticated native application context */
export interface AutomaticNativeAuthenticationContext {
  enrollmentId: string;
  enrollmentLimiterDigest: string;
  platform: "android" | "ios";
  scopes: AutomaticCheckinNativeScope[];
  serverPolicyGeneration: number;
  subject: string;
}

/** fixed native authentication result */
export type AutomaticNativeAuthenticationResult =
  | {
      context: AutomaticNativeAuthenticationContext;
      authenticated: true;
    }
  | {
      authenticated: false;
      outcome: AutomaticNativeAuthenticationOutcome;
      serverPolicyGeneration: number | null;
    };

/** handler request after authentication */
export interface AutomaticNativeHandlerRequest {
  authentication: AutomaticNativeAuthenticationContext;
}

/** candidate handler request after parsing */
export type AutomaticNativeCandidateRequest = AutomaticNativeHandlerRequest & {
  candidate: AutomaticCheckinCandidateV1;
};

/** injectable native boundary dependencies */
export interface AutomaticLeaderboardNativeDependencies {
  authenticate: (input: {
    requiredScope: AutomaticCheckinNativeScope;
    token: string;
  }) => Promise<AutomaticNativeAuthenticationResult>;
  enforceHttps?: boolean;
  enforceOrigin?: boolean;
  getConfig: (
    request: AutomaticNativeHandlerRequest
  ) => Promise<AutomaticNativeConfigV1>;
  getStatus: (
    request: AutomaticNativeHandlerRequest
  ) => Promise<AutomaticNativePolicyStatusV1>;
  handleCandidate: (
    request: AutomaticNativeCandidateRequest
  ) => Promise<AutomaticCheckinResponseV1>;
  rateLimits?: Partial<
    Record<AutomaticNativeRateLimitClass, { limit: number; windowMs?: number }>
  >;
  revoke: (
    request: AutomaticNativeHandlerRequest
  ) => Promise<AutomaticNativeRevokeResultV1>;
  trustedOrigin?: string;
}

const RETRYABLE_OUTCOMES = new Set<AutomaticCheckinOutcome>([
  "history_warming",
  "rate_limited",
  "temporarily_unavailable",
]);

// recognize the candidate wire route
const isCandidateRequest = (request: Request): boolean =>
  request.method === "POST" &&
  (request.path === "/candidates" || request.path.startsWith("/candidates/"));

// map boundary failures into the candidate contract
const candidateOutcomeFor = (
  outcome: AutomaticNativeErrorCode
): AutomaticCheckinOutcome => {
  // retain shared candidate outcomes
  if (AUTOMATIC_CHECKIN_OUTCOMES.includes(outcome as AutomaticCheckinOutcome)) {
    return outcome as AutomaticCheckinOutcome;
  }
  // normalize application failures
  if (outcome === "internal_error") {
    return "temporarily_unavailable";
  }
  // normalize candidate route mismatches
  if (outcome === "not_found") {
    return "invalid_candidate";
  }
  return "authentication_failed";
};

// apply the native cache boundary
const applyNativeHeaders = (response: Response): void => {
  response.set({
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Surrogate-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive",
  });
  response.type("application/json");
};

// normalize public policy generations
const safePolicyGeneration = (value: number | null): number | null => {
  // reject unsafe generations
  if (value === null || (Number.isSafeInteger(value) && value >= 0)) {
    return value;
  }
  return null;
};

// parse one exact revoke result
const parseAutomaticNativeRevokeResult = (
  value: unknown
): AutomaticNativeRevokeResultV1 | null => {
  // require one plain object
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // require the fixed public key set
  if (
    Object.keys(record).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(record, "revoked") ||
    !Object.prototype.hasOwnProperty.call(record, "schemaVersion") ||
    !Object.prototype.hasOwnProperty.call(record, "serverPolicyGeneration") ||
    record.revoked !== true ||
    record.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  const serverPolicyGeneration = safePolicyGeneration(
    record.serverPolicyGeneration as number | null
  );
  // reject unsafe application generations
  if (serverPolicyGeneration === null) {
    return null;
  }
  return {
    revoked: true,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    serverPolicyGeneration,
  };
};

// send the candidate envelope
const sendCandidateFailure = (
  response: Response,
  status: number,
  outcome: AutomaticCheckinOutcome,
  serverPolicyGeneration: number | null
): void => {
  // classify retry behavior
  const disposition = RETRYABLE_OUTCOMES.has(outcome) ? "retryable" : "final";
  const body: AutomaticCheckinResponseV1 = {
    credited: false,
    disposition,
    outcome,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    serverPolicyGeneration: safePolicyGeneration(serverPolicyGeneration),
  };
  applyNativeHeaders(response);
  response.status(status).json(body);
};

// send a detail-free native error
const sendNativeError = (
  response: Response,
  status: number,
  error: AutomaticNativeErrorCode,
  serverPolicyGeneration: number | null
): void => {
  applyNativeHeaders(response);
  response.status(status).json({
    error,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    serverPolicyGeneration: safePolicyGeneration(serverPolicyGeneration),
  });
};

// send the route-specific failure shape
const sendNativeFailure = (
  request: Request,
  response: Response,
  status: number,
  outcome: AutomaticNativeErrorCode,
  serverPolicyGeneration: number | null
): void => {
  // preserve the candidate contract
  if (isCandidateRequest(request)) {
    const candidateOutcome = candidateOutcomeFor(outcome);
    sendCandidateFailure(
      response,
      status,
      candidateOutcome,
      serverPolicyGeneration
    );
    return;
  }
  sendNativeError(response, status, outcome, serverPolicyGeneration);
};

// read one strict bearer token
const bearerToken = (request: Request): string | null => {
  const authorization = request.get("authorization");
  // reject absent or malformed credentials
  if (!authorization) {
    return null;
  }
  return BEARER_PATTERN.exec(authorization)?.[1] ?? null;
};

// resolve one trusted production origin
const configuredTrustedOrigin = (configured?: string): string | null => {
  const value = configured ?? process.env.BASE_URL;
  // reject missing configuration
  if (!value) {
    return null;
  }
  // normalize only origin URLs
  try {
    const url = new URL(value);
    // reject credential or path-bearing configuration
    if (
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

// build the dedicated native router
export const createAutomaticLeaderboardNativeRouter = (
  dependencies: AutomaticLeaderboardNativeDependencies
): Router => {
  const router = Router({ caseSensitive: true, strict: true });
  const authenticationContexts = new WeakMap<
    Request,
    AutomaticNativeAuthenticationContext
  >();
  const trustedOrigin = configuredTrustedOrigin(dependencies.trustedOrigin);
  const enforceHttps =
    dependencies.enforceHttps ?? process.env.NODE_ENV === "production";
  const enforceOrigin =
    dependencies.enforceOrigin ?? process.env.NODE_ENV === "production";

  // read limiter overrides safely
  const rateLimitOptions = (routeClass: AutomaticNativeRateLimitClass) => {
    return dependencies.rateLimits?.[routeClass];
  };

  // resolve post-auth limiter keys
  const enrollmentLimiterKey = (request: Request): string => {
    return (
      authenticationContexts.get(request)?.enrollmentLimiterDigest ??
      "missing-authentication-context"
    );
  };

  // emit fixed limiter failures
  const limited: RequestHandler = (request, response) => {
    const generation =
      authenticationContexts.get(request)?.serverPolicyGeneration ?? null;
    sendNativeFailure(request, response, 429, "rate_limited", generation);
  };

  // create one configured limiter
  const limiter = (
    routeClass: AutomaticNativeRateLimitClass,
    keyGenerator?: (request: Request) => string
  ): RequestHandler => {
    const options = rateLimitOptions(routeClass);
    return createAutomaticNativeRateLimitMiddleware({
      handler: limited,
      keyGenerator,
      limit: options?.limit,
      routeClass,
      windowMs: options?.windowMs,
    });
  };

  const ipBurstLimiter = limiter("ip-burst");
  const ipDailyLimiter = limiter("ip-daily");
  const enrollmentBurstLimiter = limiter(
    "enrollment-burst",
    enrollmentLimiterKey
  );
  const enrollmentDailyLimiter = limiter(
    "enrollment-daily",
    enrollmentLimiterKey
  );

  // enforce no-store before every exit
  router.use((_request, response, next) => {
    applyNativeHeaders(response);
    next();
  });

  // reject transport and origin confusion
  router.use((request, response, next) => {
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    // require direct https handling without redirects
    if (enforceHttps && request.protocol !== "https") {
      sendNativeFailure(request, response, 403, "https_required", null);
      return;
    }
    // require one configured request origin
    if (enforceOrigin && (!trustedOrigin || requestOrigin !== trustedOrigin)) {
      sendNativeFailure(request, response, 403, "origin_not_allowed", null);
      return;
    }
    const origin = request.get("origin");
    // reject browser-origin confusion when present
    if (origin && (!trustedOrigin || origin !== trustedOrigin)) {
      sendNativeFailure(request, response, 403, "origin_not_allowed", null);
      return;
    }
    next();
  });

  // reject compressed request bodies
  router.use((request, response, next) => {
    const encoding = request.get("content-encoding");
    // allow only absent or identity encoding
    if (encoding && encoding.trim().toLowerCase() !== "identity") {
      sendNativeFailure(request, response, 415, "unsupported_encoding", null);
      return;
    }
    next();
  });

  // reject query-bearing native routes
  router.use((request, response, next) => {
    // require one exact query-free endpoint
    if (request.originalUrl.includes("?")) {
      sendNativeFailure(request, response, 404, "not_found", null);
      return;
    }
    next();
  });

  // authenticate one exact native scope
  const authenticate = (
    requiredScope: AutomaticCheckinNativeScope
  ): RequestHandler => {
    return async (request, response, next) => {
      const token = bearerToken(request);
      // reject malformed bearer headers before service work
      if (!token) {
        response.set("WWW-Authenticate", "Bearer");
        sendNativeFailure(
          request,
          response,
          401,
          "authentication_failed",
          null
        );
        return;
      }
      let result: AutomaticNativeAuthenticationResult;
      // isolate authentication service outages
      try {
        result = await dependencies.authenticate({ requiredScope, token });
      } catch {
        // retain credentials on ambiguous infrastructure failures
        sendNativeFailure(request, response, 503, "internal_error", null);
        return;
      }
      // preserve fixed authentication outcomes
      if (!result.authenticated) {
        sendNativeFailure(
          request,
          response,
          401,
          result.outcome,
          result.serverPolicyGeneration
        );
        return;
      }
      const { context } = result;
      // reject unsafe internal authentication context
      if (
        !SHA256_HEX_PATTERN.test(context.enrollmentLimiterDigest) ||
        typeof context.enrollmentId !== "string" ||
        context.enrollmentId.length === 0 ||
        (context.platform !== "android" && context.platform !== "ios") ||
        !Array.isArray(context.scopes) ||
        !context.scopes.includes(requiredScope) ||
        typeof context.subject !== "string" ||
        context.subject.length === 0 ||
        safePolicyGeneration(context.serverPolicyGeneration) === null
      ) {
        sendNativeFailure(
          request,
          response,
          401,
          "authentication_failed",
          null
        );
        return;
      }
      authenticationContexts.set(request, context);
      next();
    };
  };

  // require candidate media type
  const requireCandidateMediaType: RequestHandler = (
    request,
    response,
    next
  ) => {
    // accept only application json
    if (request.is("application/json") !== "application/json") {
      sendCandidateFailure(response, 415, "unsupported_media_type", null);
      return;
    }
    next();
  };

  // reject oversized declared identity bodies
  const requireCandidateContentLength: RequestHandler = (
    request,
    response,
    next
  ) => {
    const declared = request.get("content-length");
    // defer chunked bodies to the parser limit
    if (declared === undefined) {
      next();
      return;
    }
    // reject malformed declared lengths
    if (!/^\d+$/u.test(declared)) {
      sendCandidateFailure(response, 400, "malformed_payload", null);
      return;
    }
    // reject declared oversize before parsing
    if (Number(declared) > AUTOMATIC_CHECKIN_MAX_BODY_BYTES) {
      sendCandidateFailure(response, 413, "payload_too_large", null);
      return;
    }
    next();
  };

  const parseCandidate = express.json({
    inflate: false,
    limit: AUTOMATIC_CHECKIN_MAX_BODY_BYTES,
    strict: true,
    type: "application/json",
  });

  // require strict candidate semantics
  const requireCandidateSemantics: RequestHandler = (
    request,
    response,
    next
  ) => {
    const candidate = parseAutomaticCheckinCandidateV1(request.body);
    // reject invalid candidate objects
    if (!candidate) {
      sendCandidateFailure(response, 422, "invalid_candidate", null);
      return;
    }
    request.body = candidate;
    next();
  };

  // resolve one authenticated request context
  const requestContext = (
    request: Request
  ): AutomaticNativeAuthenticationContext => {
    const context = authenticationContexts.get(request);
    // fail closed on impossible middleware order
    if (!context) {
      throw new Error("missing automatic native authentication context");
    }
    return context;
  };

  // run one config request
  const getConfig: RequestHandler = async (request, response) => {
    const authentication = requestContext(request);
    const body = await dependencies.getConfig({ authentication });
    const parsed = trustedOrigin
      ? await parseAutomaticNativeConfigV1(body, trustedOrigin)
      : null;
    // reject unsafe application output
    if (!parsed) {
      sendNativeError(
        response,
        503,
        "internal_error",
        authentication.serverPolicyGeneration
      );
      return;
    }
    response.status(200).json(parsed);
  };

  // run one status request
  const getStatus: RequestHandler = async (request, response) => {
    const authentication = requestContext(request);
    const body = await dependencies.getStatus({ authentication });
    const parsed = parseAutomaticNativePolicyStatusV1(body);
    // reject unsafe application output
    if (!parsed) {
      sendNativeError(
        response,
        503,
        "internal_error",
        authentication.serverPolicyGeneration
      );
      return;
    }
    response.status(200).json(parsed);
  };

  // run one candidate request
  const handleCandidate: RequestHandler = async (request, response) => {
    const authentication = requestContext(request);
    const body = await dependencies.handleCandidate({
      authentication,
      candidate: request.body as AutomaticCheckinCandidateV1,
    });
    const parsed = parseAutomaticCheckinResponseV1(body);
    // require authenticated application generations
    if (!parsed || parsed.serverPolicyGeneration === null) {
      sendCandidateFailure(
        response,
        503,
        "temporarily_unavailable",
        authentication.serverPolicyGeneration
      );
      return;
    }
    response.status(parsed.credited ? 201 : 200).json(parsed);
  };

  // run one self-revocation request
  const revoke: RequestHandler = async (request, response) => {
    const authentication = requestContext(request);
    const result = await dependencies.revoke({ authentication });
    const parsed = parseAutomaticNativeRevokeResult(result);
    // reject unsafe application output
    if (!parsed) {
      sendNativeError(
        response,
        503,
        "internal_error",
        authentication.serverPolicyGeneration
      );
      return;
    }
    response.status(200).json(parsed);
  };

  // reject implicit head routing
  router.head("/config", (_request, response) => {
    sendNativeError(response, 404, "not_found", null);
  });
  // reject implicit head routing
  router.head("/status", (_request, response) => {
    sendNativeError(response, 404, "not_found", null);
  });

  router.get(
    "/config",
    ipBurstLimiter,
    ipDailyLimiter,
    authenticate("automatic-checkins:config:read"),
    enrollmentBurstLimiter,
    enrollmentDailyLimiter,
    getConfig
  );
  router.get(
    "/status",
    ipBurstLimiter,
    ipDailyLimiter,
    authenticate("automatic-checkins:status:read"),
    enrollmentBurstLimiter,
    enrollmentDailyLimiter,
    getStatus
  );
  router.post(
    "/candidates",
    requireCandidateMediaType,
    requireCandidateContentLength,
    parseCandidate,
    requireCandidateSemantics,
    ipBurstLimiter,
    ipDailyLimiter,
    authenticate("automatic-checkins:candidates:write"),
    enrollmentBurstLimiter,
    enrollmentDailyLimiter,
    handleCandidate
  );
  router.delete(
    "/enrollment",
    ipBurstLimiter,
    ipDailyLimiter,
    authenticate("automatic-checkins:enrollment:revoke"),
    enrollmentBurstLimiter,
    enrollmentDailyLimiter,
    revoke
  );

  // close the isolated namespace
  router.use((request, response) => {
    sendNativeFailure(request, response, 404, "not_found", null);
  });

  // normalize parser and application failures
  const nativeErrorHandler: ErrorRequestHandler = (
    error,
    request,
    response,
    // preserve the express error signature
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next
  ) => {
    const status = (error as { status?: unknown })?.status;
    // normalize parser oversize
    if (status === 413) {
      sendNativeFailure(request, response, 413, "payload_too_large", null);
      return;
    }
    // normalize parser syntax and strict failures
    if (status === 400) {
      sendNativeFailure(request, response, 400, "malformed_payload", null);
      return;
    }
    const generation =
      authenticationContexts.get(request)?.serverPolicyGeneration ?? null;
    // preserve the candidate application contract
    if (isCandidateRequest(request)) {
      sendCandidateFailure(
        response,
        503,
        "temporarily_unavailable",
        generation
      );
      return;
    }
    sendNativeError(response, 500, "internal_error", generation);
  };
  router.use(nativeErrorHandler);

  return router;
};

const AUTOMATIC_NATIVE_FLEET_CONTEXT_MAX_AGE_MS = 2 * 60_000;
const AUTOMATIC_NATIVE_MAX_PENDING_CANDIDATES = 24;

// read one database clock value
const readAutomaticNativeDatabaseNowMs = async (): Promise<number> => {
  const rows = await db.query<{ nowMs: string }>(
    `SELECT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint AS "nowMs"`,
    { type: QueryTypes.SELECT }
  );
  const nowMs = Number(rows[0]?.nowMs);
  // reject unsafe database clock output
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("automatic native database clock unavailable");
  }
  return nowMs;
};

let productionCandidateHandler: ReturnType<
  typeof createLeaderboardAutomaticCandidateHandler
> | null = null;
const productionTerminalProofEvaluator =
  createLeaderboardAutomaticTerminalProofEvaluator();

// lazily bind the production candidate secret
const getProductionCandidateHandler = (): ReturnType<
  typeof createLeaderboardAutomaticCandidateHandler
> => {
  // reuse one validated handler
  if (productionCandidateHandler) {
    return productionCandidateHandler;
  }
  productionCandidateHandler = createLeaderboardAutomaticCandidateHandler({
    candidateKeyPepper:
      process.env.LEADERBOARD_AUTOMATIC_CANDIDATE_KEY_PEPPER ??
      process.env.LEADERBOARD_AUTOMATIC_TOKEN_PEPPER ??
      "",
    proofEvaluator: productionTerminalProofEvaluator,
  });
  return productionCandidateHandler;
};

// compose the production service boundary
const productionDependencies: AutomaticLeaderboardNativeDependencies = {
  // authenticate against the durable scoped credential service
  authenticate: async ({ requiredScope, token }) =>
    await authenticateAutomaticEnrollmentBearer(token, requiredScope),
  // serialize immutable config with one database clock
  getConfig: async ({ authentication }) => {
    const serverTimeMs = await readAutomaticNativeDatabaseNowMs();
    const now = new Date(serverTimeMs);
    const [config, configPolicy] = await Promise.all([
      loadCurrentAutomaticTerminalConfig(undefined, now),
      getAuthenticatedAutomaticEnrollmentConfigPolicy(authentication, now),
    ]);
    return {
      configGeneration: config.configGeneration,
      contentHash: config.contentHash,
      detectors: {
        terminalEnabled: configPolicy.terminalEnabled,
        vesselEnabled: configPolicy.vesselEnabled,
      },
      generatedAtMs: config.generatedAt.getTime(),
      parameters: {
        candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
        fleetContextMaxAgeMs: AUTOMATIC_NATIVE_FLEET_CONTEXT_MAX_AGE_MS,
        futureToleranceMs: AUTOMATIC_RECEIPT_FUTURE_TOLERANCE_MS,
        maxLocationAccuracyMillimeters:
          AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
        maxPendingCandidates: AUTOMATIC_NATIVE_MAX_PENDING_CANDIDATES,
      },
      regions: config.regions,
      schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
      serverPolicyGeneration: configPolicy.serverPolicyGeneration,
      serverTimeMs,
      urls: automaticEnrollmentNativeUrls(),
    };
  },
  // return the fixed authenticated policy status
  getStatus: async ({ authentication }) =>
    await getAuthenticatedAutomaticEnrollmentStatus(authentication),
  // bind the parsed candidate to durable receipt processing
  handleCandidate: async ({ authentication, candidate }) =>
    await getProductionCandidateHandler()({
      candidate,
      enrollmentId: authentication.enrollmentId,
      subject: authentication.subject,
    }),
  // revoke only the authenticated enrollment
  revoke: async ({ authentication }) =>
    await nativeRevokeAutomaticEnrollment(authentication),
};

export const automaticLeaderboardNativeRouter =
  createAutomaticLeaderboardNativeRouter(productionDependencies);
