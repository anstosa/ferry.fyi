import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_MAX_BODY_BYTES,
  AutomaticCheckinCandidateV1,
  AutomaticNativeConfigV1,
  AutomaticTerminalRegionV1,
} from "../../shared/contracts/leaderboards";
import {
  automaticTerminalRegionContentHashV1,
  bytesToLowerHex,
  canonicalAutomaticCheckinCandidateBytesV1,
  canonicalAutomaticTerminalRegionBytesV1,
  hasValidAutomaticNativeConfigContentHashV1,
  parseAutomaticCheckinCandidateJsonV1,
  parseAutomaticCheckinCandidateV1,
  parseAutomaticCheckinResponseV1,
  parseAutomaticEnrollmentStatusV1,
  parseAutomaticNativeConfigV1,
  parseAutomaticNativePolicyStatusV1,
  payloadDigestV1,
} from "../../shared/lib/leaderboardAutomaticContracts";

interface DigestFixture {
  schemaVersion: number;
  vectors: Array<{
    candidate: unknown;
    canonicalHex: string;
    digestHex: string;
    name: string;
  }>;
}

const fixturePath = path.resolve(
  __dirname,
  "../../shared/fixtures/leaderboard-automatic-payload-digest-v1.json"
);
const digestFixture = JSON.parse(
  readFileSync(fixturePath, "utf8")
) as DigestFixture;
const TRUSTED_NATIVE_ORIGIN = "https://ferry.fyi";

const terminalCandidate: AutomaticCheckinCandidateV1 = {
  accuracyMillimeters: 12500,
  candidateId: "AAECAwQFBgcICQoLDA0ODw",
  capturedAtMs: 1720000000123,
  configGeneration: 7,
  kind: "terminal",
  latitudeE7: 473000001,
  longitudeE7: -1225000001,
  schemaVersion: 1,
  terminalId: "3",
};

const vesselCandidate: AutomaticCheckinCandidateV1 = {
  accuracyMillimeters: 12500,
  candidateId: "EBESExQVFhcYGRobHB0eHw",
  capturedAtMs: 1720000000999,
  kind: "vessel",
  latitudeE7: 473000001,
  longitudeE7: -1225000001,
  sailingId: "144:1720000000",
  schemaVersion: 1,
  vesselId: "144",
};

// build a valid immutable region
const region = (
  terminalId: string,
  configGeneration = 7
): AutomaticTerminalRegionV1 => ({
  configGeneration,
  latitudeE7: 473000000,
  longitudeE7: -1225000000,
  radiusMillimeters: 304800,
  terminalId,
});

// build a strict native configuration
const nativeConfig = async (): Promise<AutomaticNativeConfigV1> => {
  const regions = [region("1"), region("2")];
  return {
    configGeneration: 7,
    contentHash: await automaticTerminalRegionContentHashV1(regions),
    detectors: { terminalEnabled: true, vesselEnabled: false },
    generatedAtMs: 1720000000000,
    parameters: {
      candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
      fleetContextMaxAgeMs: 120000,
      futureToleranceMs: 30000,
      maxLocationAccuracyMillimeters: 100000,
      maxPendingCandidates: 24,
    },
    regions,
    schemaVersion: 1,
    serverPolicyGeneration: 11,
    serverTimeMs: 1720000001000,
    urls: {
      candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
      config: "https://ferry.fyi/api/leaderboards/native/config",
      enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment",
      status: "https://ferry.fyi/api/leaderboards/native/status",
    },
  };
};

describe("automatic check-in candidate v1", () => {
  // exact discriminated shapes
  it("accepts only terminal and vessel semantic fields", () => {
    expect(parseAutomaticCheckinCandidateV1(terminalCandidate)).toEqual(
      terminalCandidate
    );
    expect(parseAutomaticCheckinCandidateV1(vesselCandidate)).toEqual(
      vesselCandidate
    );
    expect(
      parseAutomaticCheckinCandidateV1({
        ...terminalCandidate,
        sailingId: "not-terminal-data",
      })
    ).toBeNull();
    expect(
      parseAutomaticCheckinCandidateV1({
        ...vesselCandidate,
        configGeneration: 7,
      })
    ).toBeNull();
  });

  // strict schema failures
  it.each([
    ["extra field", { ...terminalCandidate, extra: true }],
    ["client expiry", { ...terminalCandidate, expiresAt: 1720000001000 }],
    ["unknown schema", { ...terminalCandidate, schemaVersion: 2 }],
    ["unknown kind", { ...terminalCandidate, kind: "route" }],
    ["floating latitude", { ...terminalCandidate, latitudeE7: 1.5 }],
    ["non-finite latitude", { ...terminalCandidate, latitudeE7: Infinity }],
    ["latitude overflow", { ...terminalCandidate, latitudeE7: 900000001 }],
    ["longitude overflow", { ...terminalCandidate, longitudeE7: -1800000001 }],
    ["negative accuracy", { ...terminalCandidate, accuracyMillimeters: -1 }],
    [
      "accuracy overflow",
      { ...terminalCandidate, accuracyMillimeters: 0x100000000 },
    ],
    [
      "timestamp overflow",
      { ...terminalCandidate, capturedAtMs: Number.MAX_VALUE },
    ],
    ["short candidate ID", { ...terminalCandidate, candidateId: "short" }],
    [
      "padded candidate ID",
      { ...terminalCandidate, candidateId: "AAAAAAAAAAAAAAAAAAAAAA==" },
    ],
    [
      "non-128-bit ID",
      { ...terminalCandidate, candidateId: "AAAAAAAAAAAAAAAAAAAAAB" },
    ],
    ["empty terminal ID", { ...terminalCandidate, terminalId: "" }],
    ["lone surrogate", { ...terminalCandidate, terminalId: "\ud800" }],
  ])("rejects %s", (_name, candidate) => {
    expect(parseAutomaticCheckinCandidateV1(candidate)).toBeNull();
  });

  // raw endpoint bound
  it("accepts 4096 bytes and rejects 4097 before semantics", () => {
    const json = JSON.stringify(terminalCandidate);
    const { byteLength } = new TextEncoder().encode(json);
    const exact = `${json}${" ".repeat(
      AUTOMATIC_CHECKIN_MAX_BODY_BYTES - byteLength
    )}`;

    expect(new TextEncoder().encode(exact)).toHaveLength(4096);
    expect(parseAutomaticCheckinCandidateJsonV1(exact)).toMatchObject({
      ok: true,
    });
    expect(parseAutomaticCheckinCandidateJsonV1(`${exact} `)).toEqual({
      error: "payload_too_large",
      ok: false,
    });
    expect(parseAutomaticCheckinCandidateJsonV1("{")).toEqual({
      error: "malformed_payload",
      ok: false,
    });
    expect(parseAutomaticCheckinCandidateJsonV1("[]")).toEqual({
      error: "schema_invalid",
      ok: false,
    });
  });

  // exact scaled accuracy range
  it("accepts uint32 minimum and maximum accuracy", () => {
    expect(
      parseAutomaticCheckinCandidateV1({
        ...terminalCandidate,
        accuracyMillimeters: 0,
      })
    ).not.toBeNull();
    expect(
      parseAutomaticCheckinCandidateV1({
        ...terminalCandidate,
        accuracyMillimeters: 0xffffffff,
      })
    ).not.toBeNull();
  });
});

describe("automatic payload digest v1", () => {
  // cross-platform release vectors
  it("matches every canonical byte and SHA-256 golden vector", async () => {
    expect(digestFixture.schemaVersion).toBe(1);

    // verify every native vector
    for (const vector of digestFixture.vectors) {
      const candidate = parseAutomaticCheckinCandidateV1(vector.candidate);
      expect(candidate, vector.name).not.toBeNull();
      expect(
        bytesToLowerHex(
          canonicalAutomaticCheckinCandidateBytesV1(
            candidate as AutomaticCheckinCandidateV1
          )
        ),
        vector.name
      ).toBe(vector.canonicalHex);
      expect(
        await payloadDigestV1(candidate as AutomaticCheckinCandidateV1),
        vector.name
      ).toBe(vector.digestHex);
    }
  });

  // semantic JSON normalization
  it("ignores JSON field order but binds every semantic field", async () => {
    const reordered = {
      vesselId: vesselCandidate.vesselId,
      schemaVersion: vesselCandidate.schemaVersion,
      sailingId: vesselCandidate.sailingId,
      longitudeE7: vesselCandidate.longitudeE7,
      latitudeE7: vesselCandidate.latitudeE7,
      kind: vesselCandidate.kind,
      capturedAtMs: vesselCandidate.capturedAtMs,
      candidateId: vesselCandidate.candidateId,
      accuracyMillimeters: vesselCandidate.accuracyMillimeters,
    };
    const baseline = await payloadDigestV1(vesselCandidate);
    expect(await payloadDigestV1(reordered)).toBe(baseline);

    const mutations: AutomaticCheckinCandidateV1[] = [
      { ...vesselCandidate, candidateId: "AAAAAAAAAAAAAAAAAAAAAA" },
      { ...vesselCandidate, capturedAtMs: vesselCandidate.capturedAtMs + 1 },
      { ...vesselCandidate, latitudeE7: vesselCandidate.latitudeE7 + 1 },
      { ...vesselCandidate, longitudeE7: vesselCandidate.longitudeE7 + 1 },
      {
        ...vesselCandidate,
        accuracyMillimeters: vesselCandidate.accuracyMillimeters + 1,
      },
      { ...vesselCandidate, vesselId: `${vesselCandidate.vesselId}a` },
      { ...vesselCandidate, sailingId: `${vesselCandidate.sailingId}a` },
    ];

    // prove each semantic mutation is bound
    for (const mutation of mutations) {
      expect(await payloadDigestV1(mutation)).not.toBe(baseline);
    }

    const terminalBaseline = await payloadDigestV1(terminalCandidate);
    expect(
      await payloadDigestV1({
        ...terminalCandidate,
        configGeneration: terminalCandidate.configGeneration + 1,
      })
    ).not.toBe(terminalBaseline);
    expect(
      await payloadDigestV1({
        ...terminalCandidate,
        terminalId: `${terminalCandidate.terminalId}a`,
      })
    ).not.toBe(terminalBaseline);
    expect(terminalBaseline).not.toBe(baseline);
  });
});

describe("automatic response and aggregate contracts", () => {
  // fixed response semantics
  it("accepts consistent final and retryable envelopes", () => {
    expect(
      parseAutomaticCheckinResponseV1({
        credited: true,
        disposition: "final",
        outcome: "credited",
        schemaVersion: 1,
        serverPolicyGeneration: 11,
      })
    ).not.toBeNull();
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "retryable",
        outcome: "history_warming",
        retryAfterSeconds: 30,
        schemaVersion: 1,
        serverPolicyGeneration: 11,
      })
    ).not.toBeNull();
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "final",
        outcome: "payload_too_large",
        schemaVersion: 1,
        serverPolicyGeneration: null,
      })
    ).not.toBeNull();
    // accept both pre-auth redaction and locked post-auth disclosure
    for (const serverPolicyGeneration of [null, 12]) {
      expect(
        parseAutomaticCheckinResponseV1({
          credited: false,
          disposition: "final",
          outcome: "authentication_failed",
          schemaVersion: 1,
          serverPolicyGeneration,
        })
      ).not.toBeNull();
    }
    // accept infrastructure ambiguity before or after authentication
    for (const serverPolicyGeneration of [null, 12]) {
      expect(
        parseAutomaticCheckinResponseV1({
          credited: false,
          disposition: "retryable",
          outcome: "temporarily_unavailable",
          schemaVersion: 1,
          serverPolicyGeneration,
        })
      ).not.toBeNull();
    }
  });

  // detail-free response boundary
  it.each([
    ["free text", { detail: "bad candidate" }],
    ["candidate", { candidateId: terminalCandidate.candidateId }],
    ["entity", { terminalId: "3" }],
    ["location", { latitudeE7: 473000000 }],
  ])("rejects response %s", (_name, details) => {
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "final",
        outcome: "expired",
        schemaVersion: 1,
        serverPolicyGeneration: 11,
        ...details,
      })
    ).toBeNull();
  });

  // response state invariants
  it("rejects inconsistent outcome, credit, retry, and policy state", () => {
    expect(
      parseAutomaticCheckinResponseV1({
        credited: true,
        disposition: "final",
        outcome: "expired",
        schemaVersion: 1,
        serverPolicyGeneration: 11,
      })
    ).toBeNull();
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "final",
        outcome: "history_warming",
        schemaVersion: 1,
        serverPolicyGeneration: 11,
      })
    ).toBeNull();
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "final",
        outcome: "expired",
        retryAfterSeconds: 30,
        schemaVersion: 1,
        serverPolicyGeneration: 11,
      })
    ).toBeNull();
    expect(
      parseAutomaticCheckinResponseV1({
        credited: false,
        disposition: "final",
        outcome: "expired",
        schemaVersion: 1,
        serverPolicyGeneration: null,
      })
    ).toBeNull();
  });

  // aggregate-only status
  it("accepts aggregate status and rejects details", () => {
    const status = {
      capabilityVersion: 1,
      configGeneration: 7,
      credentialExpiryBucket: "seven_days_or_more",
      lastOutcome: "credited",
      monitorHealth: "healthy",
      pendingCandidateCount: 2,
      permissionHealth: "authorized",
      platform: "android",
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    };
    expect(parseAutomaticEnrollmentStatusV1(status)).toEqual(status);
    expect(
      parseAutomaticEnrollmentStatusV1({
        ...status,
        lastOutcome: "cleanup_required",
        monitorHealth: "first_unlock_required",
      })
    ).not.toBeNull();
    const privateDetails = [
      { candidateId: terminalCandidate.candidateId },
      { detail: "healthy" },
      { latitudeE7: 473000000 },
      { terminalId: "3" },
      { vesselId: "144" },
    ];

    // reject every private detail class
    for (const details of privateDetails) {
      expect(parseAutomaticEnrollmentStatusV1({ ...status, ...details })).toBe(
        null
      );
    }
  });

  // fixed server policy status
  it("accepts only the exact native policy status shape", () => {
    const status = {
      automaticEnabled: false,
      credentialExpiryBucket: "less_than_7_days",
      rotateRecommended: true,
      schemaVersion: 1,
      serverPolicyGeneration: 11,
    };

    expect(parseAutomaticNativePolicyStatusV1(status)).toEqual(status);
    expect(
      parseAutomaticNativePolicyStatusV1({ ...status, enrollmentId: "private" })
    ).toBeNull();
    expect(
      parseAutomaticNativePolicyStatusV1({
        ...status,
        credentialExpiryBucket: "tomorrow",
      })
    ).toBeNull();
    expect(
      parseAutomaticNativePolicyStatusV1({
        ...status,
        serverPolicyGeneration: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toBeNull();
  });
});

describe("automatic native configuration contract", () => {
  // immutable content hashing
  it("sorts geometry and excludes generation from the content hash", async () => {
    const first = [region("2", 7), region("1", 7)];
    const reverted = [region("1", 8), region("2", 8)];
    expect(
      new TextDecoder().decode(canonicalAutomaticTerminalRegionBytesV1(first))
    ).toBe(
      '[{"latitudeE7":473000000,"longitudeE7":-1225000000,"radiusMillimeters":304800,"terminalId":"1"},{"latitudeE7":473000000,"longitudeE7":-1225000000,"radiusMillimeters":304800,"terminalId":"2"}]'
    );
    expect(await automaticTerminalRegionContentHashV1(first)).toBe(
      await automaticTerminalRegionContentHashV1(reverted)
    );
    expect(() => canonicalAutomaticTerminalRegionBytesV1([])).toThrow(
      "invalid automatic terminal regions"
    );
    expect(() =>
      canonicalAutomaticTerminalRegionBytesV1([region("1", 7), region("2", 8)])
    ).toThrow("invalid automatic terminal regions");
  });

  // strict complete configuration
  it("accepts a complete hash-valid configuration", async () => {
    const config = await nativeConfig();
    expect(
      await parseAutomaticNativeConfigV1(config, TRUSTED_NATIVE_ORIGIN)
    ).toEqual(config);
    expect(await hasValidAutomaticNativeConfigContentHashV1(config)).toBe(true);
  });

  // fail-closed configuration
  it("rejects unsafe URLs, partial regions, duplicates, and private details", async () => {
    const config = await nativeConfig();
    expect(
      await parseAutomaticNativeConfigV1(
        {
          ...config,
          urls: {
            ...config.urls,
            config: "http://ferry.fyi/api/leaderboards/native/config",
          },
        },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        {
          ...config,
          urls: {
            ...config.urls,
            status: "https://example.com/api/leaderboards/native/status",
          },
        },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        { ...config, regions: [] },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        {
          ...config,
          regions: [region("1"), region("1")],
        },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        {
          ...config,
          regions: [region("2"), region("1")],
        },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        { ...config, subject: "auth0|private" },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        { ...config, latitudeE7: 473000000 },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        { ...config, schemaVersion: 2 },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        { ...config, contentHash: "0".repeat(64) },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        {
          ...config,
          parameters: {
            ...config.parameters,
            candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS + 1,
          },
        },
        TRUSTED_NATIVE_ORIGIN
      )
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(config, "https://example.com")
    ).toBeNull();
    expect(
      await parseAutomaticNativeConfigV1(
        config,
        "https://ferry.fyi/untrusted-path"
      )
    ).toBeNull();
  });
});
