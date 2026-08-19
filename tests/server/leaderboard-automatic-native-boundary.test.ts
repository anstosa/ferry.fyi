import http from "node:http";

import express from "express";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  type AutomaticCheckinCandidateV1,
  type AutomaticNativeConfigV1,
  type AutomaticNativePolicyStatusV1,
  type AutomaticNativeRevokeResultV1,
} from "shared/contracts/leaderboards";
import { automaticTerminalRegionContentHashV1 } from "shared/lib/leaderboardAutomaticContracts";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// provide import-time server configuration
vi.hoisted(() => {
  process.env.AUTH0_CLIENT_AUDIENCE ??= "https://api.test.ferry.fyi";
  process.env.AUTH0_DOMAIN ??= "auth.test.ferry.fyi";
  process.env.DATABASE_URL ??=
    "postgres://test:testing@localhost:5432/ferryfyi";
});

import { apiRouter } from "../../server/controllers/api";
import {
  type AutomaticLeaderboardNativeDependencies,
  createAutomaticLeaderboardNativeRouter,
} from "../../server/controllers/api/leaderboardAutomaticNative";
import { createApiRateLimitMiddleware } from "../../server/lib/httpApiPolicy";
import {
  createHttpTelemetryMiddleware,
  type HttpTelemetryEvent,
} from "../../server/lib/httpTelemetry";
import { createApp } from "../../server/server";

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const TOKEN_C = "C".repeat(43);
const ENROLLMENT_DIGEST_A = "a".repeat(64);
const ENROLLMENT_DIGEST_B = "b".repeat(64);

const candidate: AutomaticCheckinCandidateV1 = {
  accuracyMillimeters: 25_000,
  candidateId: `${"A".repeat(21)}A`,
  capturedAtMs: 1_720_000_000_000,
  configGeneration: 7,
  kind: "terminal",
  latitudeE7: 473_000_000,
  longitudeE7: -1_225_000_000,
  schemaVersion: 1,
  terminalId: "7",
};

const status: AutomaticNativePolicyStatusV1 = {
  automaticEnabled: false,
  credentialExpiryBucket: "seven_days_or_more",
  rotateRecommended: false,
  schemaVersion: 1,
  serverPolicyGeneration: 11,
};

// build one strict native configuration
const nativeConfig = async (): Promise<AutomaticNativeConfigV1> => {
  const regions = [
    {
      configGeneration: 7,
      latitudeE7: 473_000_000,
      longitudeE7: -1_225_000_000,
      radiusMillimeters: 304_800,
      terminalId: "7",
    },
  ];
  return {
    configGeneration: 7,
    contentHash: await automaticTerminalRegionContentHashV1(regions),
    detectors: { terminalEnabled: true, vesselEnabled: false },
    generatedAtMs: 1_720_000_000_000,
    parameters: {
      candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
      fleetContextMaxAgeMs: 120_000,
      futureToleranceMs: 60_000,
      maxLocationAccuracyMillimeters: 100_000,
      maxPendingCandidates: 24,
    },
    regions,
    schemaVersion: 1,
    serverPolicyGeneration: 11,
    serverTimeMs: 1_720_000_001_000,
    urls: {
      candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
      config: "https://ferry.fyi/api/leaderboards/native/config",
      enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment",
      status: "https://ferry.fyi/api/leaderboards/native/status",
    },
  };
};

// build one authenticated dependency set
const nativeDependencies = (
  overrides: Partial<AutomaticLeaderboardNativeDependencies> = {}
): AutomaticLeaderboardNativeDependencies => ({
  // authenticate one fixed test token
  authenticate: ({ token }) =>
    Promise.resolve(
      token === TOKEN_A || token === TOKEN_B || token === TOKEN_C
        ? {
            authenticated: true,
            context: {
              enrollmentId: "11111111-1111-4111-8111-111111111111",
              enrollmentLimiterDigest: ENROLLMENT_DIGEST_A,
              platform: "android",
              scopes: [
                "automatic-checkins:config:read",
                "automatic-checkins:status:read",
                "automatic-checkins:candidates:write",
                "automatic-checkins:enrollment:revoke",
              ],
              serverPolicyGeneration: 11,
              subject: "auth0|native-subject",
            },
          }
        : {
            authenticated: false,
            outcome: "authentication_failed",
            serverPolicyGeneration: null,
          }
    ),
  enforceHttps: false,
  enforceOrigin: false,
  // return one strict config
  getConfig: async () => await nativeConfig(),
  // return one fixed status
  getStatus: () => Promise.resolve(status),
  // return one fixed application result
  handleCandidate: () =>
    Promise.resolve({
      credited: false,
      disposition: "final",
      outcome: "outside_terminal",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    }),
  // return one fixed revoke result
  revoke: () =>
    Promise.resolve({
      revoked: true,
      schemaVersion: 1,
      serverPolicyGeneration: 12,
    }),
  trustedOrigin: "https://ferry.fyi",
  ...overrides,
});

// mount one isolated native router
const nativeApp = (
  dependencies: AutomaticLeaderboardNativeDependencies
): express.Express => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(
    "/api/leaderboards/native",
    createAutomaticLeaderboardNativeRouter(dependencies)
  );
  return app;
};

// attach one bearer token
const authorize = (value = TOKEN_A): string => `Bearer ${value}`;

interface ChunkedResponse {
  body: unknown;
  headers: http.IncomingHttpHeaders;
  status: number;
}

// submit one identity chunked body
const submitChunked = async (
  app: express.Express,
  body: string
): Promise<ChunkedResponse> => {
  const server = app.listen(0);
  // await the listening address
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address();
  // require one tcp address
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("test server address unavailable");
  }
  // close the server after the request
  try {
    return await new Promise<ChunkedResponse>((resolve, reject) => {
      const outgoing = http.request({
        headers: {
          Authorization: authorize(),
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/api/leaderboards/native/candidates",
        port: address.port,
      });
      // collect the fixed response
      outgoing.on("response", (incoming) => {
        let responseBody = "";
        // collect every response chunk
        incoming.on("data", (chunk: Buffer) => {
          responseBody += chunk.toString("utf8");
        });
        // parse one json response
        incoming.on("end", () => {
          resolve({
            body: JSON.parse(responseBody) as unknown,
            headers: incoming.headers,
            status: incoming.statusCode ?? 0,
          });
        });
      });
      outgoing.on("error", reject);
      const midpoint = Math.floor(body.length / 2);
      outgoing.write(body.slice(0, midpoint));
      outgoing.end(body.slice(midpoint));
    });
  } finally {
    // release the test listener
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        // report close failures
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

// restore environment overrides
afterEach(() => {
  vi.unstubAllEnvs();
});

// verify server and api composition boundaries
describe("automatic native application composition", () => {
  // prove native parsing precedes ordinary parsing
  it("mounts the injected native handler before global json and ordinary api", async () => {
    const nativeHandler = express.Router();
    const apiHandler = express.Router();
    // observe the unparsed native request
    nativeHandler.post("/probe", (nativeRequest, response) => {
      response.json({ parsed: nativeRequest.body !== undefined });
    });
    // observe the parsed ordinary request
    apiHandler.post("/probe", (apiRequest, response) => {
      response.json({ parsed: apiRequest.body !== undefined });
    });
    const fallback = express
      .Router()
      .use((_request, response) => response.sendStatus(404));
    const app = createApp({
      apiHandler,
      nativeAutomaticHandler: nativeHandler,
      staticHandler: fallback,
    });

    expect(
      (
        await request(app)
          .post("/api/leaderboards/native/probe")
          .send({ private: true })
          .expect(200)
      ).body
    ).toEqual({ parsed: false });
    expect(
      (
        await request(app)
          .post("/api/probe")
          .send({ ordinary: true })
          .expect(200)
      ).body
    ).toEqual({ parsed: true });
  });

  // prove the ordinary router excludes native composition
  it("exports but never mounts the native router inside apiRouter", async () => {
    const app = express();
    app.use("/api", apiRouter);

    const response = await request(app)
      .get("/api/leaderboards/native/status")
      .expect(401);

    expect(response.body.wsfStatus).toBeDefined();
    expect(response.body.body).toEqual({ error: "unauthorized" });
  });
});

// verify exact route and scope dispatch
describe("automatic native exact routes", () => {
  // prove each route requests only its named scope
  it("dispatches exactly four query-free methods and scopes", async () => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));

    const configResponse = await request(app)
      .get("/api/leaderboards/native/config")
      .set("Authorization", authorize())
      .expect(200);
    const statusResponse = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(200);
    const candidateResponse = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(200);
    const revokeResponse = await request(app)
      .delete("/api/leaderboards/native/enrollment")
      .set("Authorization", authorize())
      .expect(200);

    // collect exact service scopes
    expect(
      authenticate.mock.calls.map(([input]) => input.requiredScope)
    ).toEqual([
      "automatic-checkins:config:read",
      "automatic-checkins:status:read",
      "automatic-checkins:candidates:write",
      "automatic-checkins:enrollment:revoke",
    ]);
    // require every response cache boundary
    for (const response of [
      configResponse,
      statusResponse,
      candidateResponse,
      revokeResponse,
    ]) {
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.wsfStatus).toBeUndefined();
    }
    expect(statusResponse.body).toEqual(status);
    expect(statusResponse.body.automaticEnabled).toBe(false);
    expect(configResponse.body.detectors).toEqual({
      terminalEnabled: true,
      vesselEnabled: false,
    });
    expect(revokeResponse.body).toEqual({
      revoked: true,
      schemaVersion: 1,
      serverPolicyGeneration: 12,
    });
  });

  // reject every implicit or variant route
  it.each([
    ["head", "/config"],
    ["head", "/status"],
    ["options", "/config"],
    ["get", "/config/"],
    ["get", "/status?candidate=private"],
    ["post", "/candidates/"],
    ["delete", "/enrollment/"],
    ["get", "/unknown"],
  ] as const)("rejects %s %s without authenticating", async (method, path) => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));
    const testRequest = request(app)
      [method](`/api/leaderboards/native${path}`)
      .set("Authorization", authorize());
    // attach candidate json for the insecure probe
    if (method === "post") {
      testRequest.set("Content-Type", "application/json").send(candidate);
    }
    const response = await testRequest.expect(404);

    expect(authenticate).not.toHaveBeenCalled();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.wsfStatus).toBeUndefined();
    // preserve candidate envelopes on candidate variants
    if (method === "post") {
      expect(response.body).toMatchObject({
        credited: false,
        outcome: "invalid_candidate",
        serverPolicyGeneration: null,
      });
    } else if (method !== "head") {
      expect(response.body).toMatchObject({ error: "not_found" });
    }
  });

  // prove scope cross-use fails before application handlers
  it("denies a bearer when its scope is cross-used", async () => {
    const getStatus = vi.fn(nativeDependencies().getStatus);
    const app = nativeApp(
      nativeDependencies({
        // return one structurally cross-scoped context
        authenticate: () =>
          Promise.resolve({
            authenticated: true,
            context: {
              enrollmentId: "11111111-1111-4111-8111-111111111111",
              enrollmentLimiterDigest: ENROLLMENT_DIGEST_A,
              platform: "ios",
              scopes: ["automatic-checkins:config:read"],
              serverPolicyGeneration: 11,
              subject: "auth0|native-subject",
            },
          }),
        getStatus,
      })
    );

    const response = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(401);

    expect(response.body).toEqual({
      error: "authentication_failed",
      schemaVersion: 1,
      serverPolicyGeneration: null,
    });
    expect(getStatus).not.toHaveBeenCalled();
  });

  // reject extra revoke service fields without disclosure
  it("rejects revoke output with unknown sensitive properties", async () => {
    const app = nativeApp(
      nativeDependencies({
        // return one contaminated service object
        revoke: () =>
          Promise.resolve({
            revoked: true,
            schemaVersion: 1,
            serverPolicyGeneration: 12,
            subject: "private-subject-canary",
          } as unknown as AutomaticNativeRevokeResultV1),
      })
    );

    const response = await request(app)
      .delete("/api/leaderboards/native/enrollment")
      .set("Authorization", authorize())
      .expect(503);

    expect(response.body).toEqual({
      error: "internal_error",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    expect(JSON.stringify(response.body)).not.toContain("private-subject");
  });
});

// verify isolated candidate parsing
describe("automatic native candidate parsing", () => {
  // prove exact declared identity boundaries
  it("accepts 4096 declared bytes and rejects 4097 before auth", async () => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));
    const serialized = JSON.stringify(candidate);
    const exact = serialized.padEnd(4096, " ");
    const oversized = serialized.padEnd(4097, " ");

    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Type", "application/json")
      .send(exact)
      .expect(200);
    const rejected = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Type", "application/json")
      .send(oversized)
      .expect(413);

    expect(Buffer.byteLength(exact)).toBe(4096);
    expect(Buffer.byteLength(oversized)).toBe(4097);
    expect(rejected.body).toMatchObject({
      credited: false,
      outcome: "payload_too_large",
      serverPolicyGeneration: null,
    });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  // accept explicit identity encoding
  it("accepts an explicit identity content encoding", async () => {
    const app = nativeApp(nativeDependencies());

    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Encoding", "identity")
      .send(candidate)
      .expect(200);
  });

  // prove exact chunked identity boundaries
  it("accepts 4096 chunked bytes and rejects 4097 before auth", async () => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));
    const serialized = JSON.stringify(candidate);
    const exact = await submitChunked(app, serialized.padEnd(4096, " "));
    const oversized = await submitChunked(app, serialized.padEnd(4097, " "));

    expect(exact.status).toBe(200);
    expect(oversized.status).toBe(413);
    expect(oversized.body).toMatchObject({
      credited: false,
      outcome: "payload_too_large",
      serverPolicyGeneration: null,
    });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  // reject unsupported encoding and media before authentication
  it.each([
    ["gzip", "application/json", "unsupported_encoding"],
    ["br", "application/json", "unsupported_encoding"],
    ["deflate", "application/json", "unsupported_encoding"],
    ["identity", "text/plain", "unsupported_media_type"],
  ])("rejects %s encoded %s", async (encoding, mediaType, outcome) => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));
    const response = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Encoding", encoding)
      .set("Content-Type", mediaType)
      .send(JSON.stringify(candidate))
      .expect(415);

    expect(response.body).toMatchObject({
      credited: false,
      outcome,
      serverPolicyGeneration: null,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  // normalize syntax, strict-json, and semantic failures
  it.each([
    ['{"incomplete":', 400, "malformed_payload"],
    ["null", 400, "malformed_payload"],
    ["{}", 422, "invalid_candidate"],
  ])("rejects candidate body %s", async (body, statusCode, outcome) => {
    const authenticate = vi.fn(nativeDependencies().authenticate);
    const app = nativeApp(nativeDependencies({ authenticate }));
    const response = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Type", "application/json")
      .send(body)
      .expect(statusCode);

    expect(response.body).toMatchObject({
      credited: false,
      outcome,
      serverPolicyGeneration: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/incomplete|Unexpected/u);
    expect(authenticate).not.toHaveBeenCalled();
  });

  // preserve recognized enrollment outcomes with current generation
  it("distinguishes unknown from recognized revoked credentials", async () => {
    const unknownApp = nativeApp(
      nativeDependencies({
        authenticate: () =>
          Promise.resolve({
            authenticated: false,
            outcome: "authentication_failed",
            serverPolicyGeneration: null,
          }),
      })
    );
    const revokedApp = nativeApp(
      nativeDependencies({
        authenticate: () =>
          Promise.resolve({
            authenticated: false,
            outcome: "enrollment_revoked",
            serverPolicyGeneration: 19,
          }),
      })
    );

    const unknown = await request(unknownApp)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(401);
    const revoked = await request(revokedApp)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(401);

    expect(unknown.body).toMatchObject({
      outcome: "authentication_failed",
      serverPolicyGeneration: null,
    });
    expect(revoked.body).toMatchObject({
      outcome: "enrollment_revoked",
      serverPolicyGeneration: 19,
    });
  });

  // retain native credentials on ambiguous authentication outages
  it("maps thrown authentication service failures to retryable detail-free responses", async () => {
    const app = nativeApp(
      nativeDependencies({
        // throw one private authentication dependency failure
        authenticate: () =>
          Promise.reject(new Error("private authentication database canary")),
      })
    );

    const candidateResponse = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(503);
    const statusResponse = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(503);

    expect(candidateResponse.body).toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
      schemaVersion: 1,
      serverPolicyGeneration: null,
    });
    expect(statusResponse.body).toEqual({
      error: "internal_error",
      schemaVersion: 1,
      serverPolicyGeneration: null,
    });
    expect(
      JSON.stringify([candidateResponse.body, statusResponse.body])
    ).not.toMatch(/authentication_failed|canary/u);
  });

  // isolate application failures from the ordinary api handler
  it("returns a fixed authenticated failure without leaking service errors", async () => {
    const apiHandler = vi.fn(
      (_request: express.Request, response: express.Response) =>
        response.send({ ordinary: true })
    );
    const nativeHandler = createAutomaticLeaderboardNativeRouter(
      nativeDependencies({
        // throw one private application failure
        handleCandidate: () =>
          Promise.reject(new Error("private candidate service canary")),
      })
    );
    const app = createApp({
      apiHandler,
      nativeAutomaticHandler: nativeHandler,
      staticHandler: express.Router(),
    });

    const response = await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(503);

    expect(response.body).toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    expect(JSON.stringify(response.body)).not.toContain("canary");
    expect(apiHandler).not.toHaveBeenCalled();
  });

  // normalize non-candidate application failures
  it("returns a detail-free native error for status failures", async () => {
    const app = nativeApp(
      nativeDependencies({
        // throw one private status failure
        getStatus: () =>
          Promise.reject(new Error("private status service canary")),
      })
    );

    const response = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(500);

    expect(response.body).toEqual({
      error: "internal_error",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    });
    expect(JSON.stringify(response.body)).not.toContain("canary");
  });
});

// verify transport, limiter, and telemetry boundaries
describe("automatic native transport and limits", () => {
  // enforce production transport without redirects
  it.each([
    ["get", "/config"],
    ["get", "/status"],
    ["post", "/candidates"],
    ["delete", "/enrollment"],
  ] as const)("requires exact https origin for %s %s", async (method, path) => {
    const app = nativeApp(
      nativeDependencies({ enforceHttps: true, enforceOrigin: true })
    );
    const insecure = request(app)
      [method](`/api/leaderboards/native${path}`)
      .set("Authorization", authorize())
      .set("Host", "ferry.fyi");
    // attach candidate json for the host probe
    if (method === "post") {
      insecure.send(candidate);
    }
    const insecureResponse = await insecure.expect(403);
    expect(insecureResponse.headers.location).toBeUndefined();

    const wrongHost = request(app)
      [method](`/api/leaderboards/native${path}`)
      .set("Authorization", authorize())
      .set("Host", "wrong.example")
      .set("X-Forwarded-Proto", "https");
    // attach candidate json for the allowed probe
    if (method === "post") {
      wrongHost.send(candidate);
    }
    const wrongHostResponse = await wrongHost.expect(403);
    expect(wrongHostResponse.headers.location).toBeUndefined();

    const allowed = request(app)
      [method](`/api/leaderboards/native${path}`)
      .set("Authorization", authorize())
      .set("Host", "ferry.fyi")
      .set("X-Forwarded-Proto", "https");
    // supply candidate media only where relevant
    if (method === "post") {
      allowed.send(candidate);
    }
    await allowed.expect(200);
  });

  // reject browser origin confusion
  it("rejects a mismatched origin without redirecting", async () => {
    const app = nativeApp(
      nativeDependencies({ enforceHttps: true, enforceOrigin: true })
    );
    const response = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .set("Host", "ferry.fyi")
      .set("Origin", "https://wrong.example")
      .set("X-Forwarded-Proto", "https")
      .expect(403);

    expect(response.body).toMatchObject({ error: "origin_not_allowed" });
    expect(response.headers.location).toBeUndefined();
  });

  // preserve no-redirect behavior through production composition
  it("bypasses global forceHttps redirect only for the native rejection", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BASE_URL", "https://ferry.fyi");
    vi.stubEnv("REPORT_BASE_URL", "https://reports.ferry.fyi");
    const nativeHandler = createAutomaticLeaderboardNativeRouter(
      nativeDependencies({ enforceHttps: true, enforceOrigin: true })
    );
    const app = createApp({
      apiHandler: express.Router(),
      nativeAutomaticHandler: nativeHandler,
      staticHandler: express.Router(),
    });

    const response = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .set("Host", "ferry.fyi")
      .expect(403);

    expect(response.headers.location).toBeUndefined();
    expect(response.body).toMatchObject({ error: "https_required" });
  });

  // limit stable enrollments across credential rotation
  it("uses one post-auth digest across rotated tokens without leaking it", async () => {
    const app = nativeApp(
      nativeDependencies({
        rateLimits: {
          "enrollment-burst": { limit: 1, windowMs: 60_000 },
          "enrollment-daily": { limit: 100, windowMs: 60_000 },
          "ip-burst": { limit: 100, windowMs: 60_000 },
          "ip-daily": { limit: 100, windowMs: 60_000 },
        },
        // bind rotated credentials to one enrollment digest
        authenticate: ({ token }) =>
          Promise.resolve({
            authenticated: true,
            context: {
              enrollmentId:
                token === TOKEN_C
                  ? "22222222-2222-4222-8222-222222222222"
                  : "11111111-1111-4111-8111-111111111111",
              enrollmentLimiterDigest:
                token === TOKEN_C ? ENROLLMENT_DIGEST_B : ENROLLMENT_DIGEST_A,
              platform: "android",
              scopes: ["automatic-checkins:status:read"],
              serverPolicyGeneration: 11,
              subject: "auth0|native-subject",
            },
          }),
      })
    );

    await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize(TOKEN_A))
      .expect(200);
    const limited = await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize(TOKEN_B))
      .expect(429);
    await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize(TOKEN_C))
      .expect(200);

    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(JSON.stringify(limited.body)).not.toMatch(
      new RegExp(`${ENROLLMENT_DIGEST_A}|${TOKEN_A}|${TOKEN_B}`, "u")
    );
  });

  // separate cheap pre-auth limits by proxy-validated client ip
  it.each(["ip-burst", "ip-daily"] as const)(
    "keeps parallel client ip counters independent for %s",
    async (limitedClass) => {
      const limits = {
        "enrollment-burst": { limit: 100, windowMs: 60_000 },
        "enrollment-daily": { limit: 100, windowMs: 60_000 },
        "ip-burst": { limit: 100, windowMs: 60_000 },
        "ip-daily": { limit: 100, windowMs: 60_000 },
      };
      limits[limitedClass] = { limit: 1, windowMs: 60_000 };
      const app = nativeApp(
        nativeDependencies({
          rateLimits: limits,
        })
      );

      await request(app)
        .get("/api/leaderboards/native/status")
        .set("Authorization", "Bearer invalid")
        .set("X-Forwarded-For", "203.0.113.1")
        .expect(401);
      const limited = await request(app)
        .get("/api/leaderboards/native/status")
        .set("Authorization", "Bearer invalid")
        .set("X-Forwarded-For", "203.0.113.1")
        .expect(429);
      await request(app)
        .get("/api/leaderboards/native/status")
        .set("Authorization", "Bearer invalid")
        .set("X-Forwarded-For", "203.0.113.2")
        .expect(401);

      expect(limited.headers["retry-after"]).toBeTruthy();
    }
  );

  // keep native limits away from ordinary api counters
  it("does not apply a low native limit to ordinary routes", async () => {
    const app = nativeApp(
      nativeDependencies({
        rateLimits: {
          "enrollment-burst": { limit: 1, windowMs: 60_000 },
          "enrollment-daily": { limit: 100, windowMs: 60_000 },
          "ip-burst": { limit: 100, windowMs: 60_000 },
          "ip-daily": { limit: 100, windowMs: 60_000 },
        },
      })
    );
    vi.stubEnv("API_ANONYMOUS_READ_LIMIT", "10");
    const ordinary = express();
    ordinary.use(createApiRateLimitMiddleware());
    // return one ordinary response
    ordinary.get("/api/features", (_request, response) =>
      response.json({ ok: true })
    );

    await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(200);
    await request(app)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(429);
    await request(ordinary).get("/api/features").expect(200);
    await request(ordinary).get("/api/features").expect(200);
  });

  // keep native and ordinary limiter configuration independent
  it("does not share counters or API global limits", async () => {
    vi.stubEnv("API_ANONYMOUS_READ_LIMIT", "1");
    const native = nativeApp(
      nativeDependencies({
        rateLimits: {
          "enrollment-burst": { limit: 10 },
          "enrollment-daily": { limit: 10 },
          "ip-burst": { limit: 10 },
          "ip-daily": { limit: 10 },
        },
      })
    );
    const ordinary = express();
    ordinary.use(createApiRateLimitMiddleware());
    // return one ordinary response
    ordinary.get("/api/features", (_request, response) =>
      response.json({ ok: true })
    );

    await request(native)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(200);
    await request(native)
      .get("/api/leaderboards/native/status")
      .set("Authorization", authorize())
      .expect(200);
    await request(ordinary).get("/api/features").expect(200);
    await request(ordinary).get("/api/features").expect(429);
  });

  // redact parser, auth, and limiter telemetry through the real boundary
  it("emits fixed telemetry for malformed, auth, and limited requests", async () => {
    const sink = vi.fn<(event: HttpTelemetryEvent) => void>();
    const app = express();
    app.use(createHttpTelemetryMiddleware({ release: "v-native", sink }));
    app.use(
      "/api/leaderboards/native",
      createAutomaticLeaderboardNativeRouter(
        nativeDependencies({
          // deny every well-formed bearer
          authenticate: () =>
            Promise.resolve({
              authenticated: false,
              outcome: "authentication_failed",
              serverPolicyGeneration: null,
            }),
          rateLimits: {
            "enrollment-burst": { limit: 100, windowMs: 60_000 },
            "enrollment-daily": { limit: 100, windowMs: 60_000 },
            "ip-burst": { limit: 1, windowMs: 60_000 },
            "ip-daily": { limit: 100, windowMs: 60_000 },
          },
        })
      )
    );

    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .set("Content-Type", "application/json")
      .send('{"parserCanary":')
      .expect(400);
    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(401);
    await request(app)
      .post("/api/leaderboards/native/candidates")
      .set("Authorization", authorize())
      .send(candidate)
      .expect(429);

    expect(sink).toHaveBeenCalledTimes(3);
    // inspect every fixed event
    for (const [event] of sink.mock.calls) {
      expect(event.routeClass).toBe("api.automatic-native");
      expect(Object.keys(event).sort()).toEqual(
        [
          "completionOutcome",
          "durationMs",
          "event",
          "methodClass",
          "release",
          "routeClass",
          "schemaVersion",
          "statusClass",
        ].sort()
      );
    }
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /parserCanary|authorization|candidateId|enrollment|latitude|token|digest|limiter/i
    );
  });
});
