import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AutomaticCheckinCandidateV1,
} from "../../shared/contracts/leaderboards";
import {
  applyAutomaticQueueCapacityV1,
  AutomaticTrustedClockAnchorV1,
  AutomaticTrustedClockSampleV1,
  classifyAutomaticCandidateServerTimeV1,
  deriveAutomaticCapturedAtMsV1,
  deriveAutomaticExpiryNowMsV1,
  isAutomaticCandidateExpiredV1,
  selectAutomaticCandidateUploadHeadsV1,
} from "../../shared/lib/leaderboardAutomaticClock";

interface TrustedClockFixture {
  anchor: AutomaticTrustedClockAnchorV1;
  candidateRetentionMs: number;
  expiryBoundaries: Array<{
    capturedAtMs: number;
    expired: boolean;
    name: string;
    trustedNowMs: number;
  }>;
  readings: Array<{
    expectedCapturedAtMs: number | null;
    expectedExpiryNowMs: number | null;
    name: string;
    sample: AutomaticTrustedClockSampleV1;
  }>;
  refreshedReboot: {
    anchor: AutomaticTrustedClockAnchorV1;
    expectedExpiryNowMs: number;
    expired: boolean;
    queuedCapturedAtMs: number;
    sample: AutomaticTrustedClockSampleV1;
  };
  schemaVersion: number;
}

const clockFixture = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../shared/fixtures/leaderboard-automatic-trusted-clock-v1.json"
    ),
    "utf8"
  )
) as TrustedClockFixture;

const { anchor } = clockFixture;

// create an opaque queue candidate
const candidate = (
  candidateId: string,
  capturedAtMs: number,
  terminalId = "1"
): AutomaticCheckinCandidateV1 => ({
  accuracyMillimeters: 1000,
  candidateId,
  capturedAtMs,
  configGeneration: 1,
  kind: "terminal",
  latitudeE7: 0,
  longitudeE7: 0,
  schemaVersion: 1,
  terminalId,
});

// create independent vessel work
const vesselCandidate = (
  candidateId: string,
  capturedAtMs: number
): AutomaticCheckinCandidateV1 => ({
  accuracyMillimeters: 1000,
  candidateId,
  capturedAtMs,
  kind: "vessel",
  latitudeE7: 0,
  longitudeE7: 0,
  sailingId: `1:${capturedAtMs}`,
  schemaVersion: 1,
  vesselId: "1",
});

describe("automatic trusted clock v1", () => {
  // cross-platform clock vectors
  it("matches every trusted-clock golden reading", () => {
    expect(clockFixture.schemaVersion).toBe(1);
    expect(clockFixture.candidateRetentionMs).toBe(
      AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS
    );

    // verify every native clock vector
    for (const reading of clockFixture.readings) {
      expect(
        deriveAutomaticCapturedAtMsV1(anchor, reading.sample),
        reading.name
      ).toBe(reading.expectedCapturedAtMs);
      expect(
        deriveAutomaticExpiryNowMsV1(anchor, reading.sample),
        reading.name
      ).toBe(reading.expectedExpiryNowMs);
    }

    // verify exact shared expiry vectors
    for (const boundary of clockFixture.expiryBoundaries) {
      expect(
        isAutomaticCandidateExpiredV1(
          boundary.capturedAtMs,
          boundary.trustedNowMs
        ),
        boundary.name
      ).toBe(boundary.expired);
    }
  });

  // monotonic capture authority
  it("derives capture time without trusting wall-clock movement", () => {
    expect(
      deriveAutomaticCapturedAtMsV1(anchor, {
        bootId: "boot-a",
        monotonicTimeMs: 15000,
        wallTimeMs: anchor.wallTimeMs - 60000,
      })
    ).toBe(anchor.serverTimeMs + 5000);
    expect(
      deriveAutomaticCapturedAtMsV1(anchor, {
        bootId: "boot-a",
        monotonicTimeMs: 15000,
        wallTimeMs: anchor.wallTimeMs + 600000,
      })
    ).toBe(anchor.serverTimeMs + 5000);
    expect(
      deriveAutomaticCapturedAtMsV1(anchor, {
        bootId: "boot-a",
        monotonicTimeMs: 15000,
        wallTimeMs: anchor.wallTimeMs,
      })
    ).toBe(anchor.serverTimeMs + 5000);
  });

  // least-forgiving expiry authority
  it("uses monotonic progress, blocks rollback extension, and honors forward jumps", () => {
    expect(
      deriveAutomaticExpiryNowMsV1(anchor, {
        bootId: "boot-a",
        monotonicTimeMs: anchor.monotonicTimeMs + 5000,
        wallTimeMs: anchor.wallTimeMs - 60000,
      })
    ).toBe(anchor.serverTimeMs + 5000);
    expect(
      deriveAutomaticExpiryNowMsV1(anchor, {
        bootId: "boot-a",
        monotonicTimeMs: anchor.monotonicTimeMs + 5000,
        wallTimeMs: anchor.wallTimeMs + 600000,
      })
    ).toBe(anchor.serverTimeMs + 600000);
  });

  // reboot boundary
  it("blocks capture and upload until a new same-boot server anchor exists", () => {
    const rebootSample = {
      bootId: "boot-b",
      monotonicTimeMs: 100,
      wallTimeMs: anchor.wallTimeMs + 1000,
    };
    expect(deriveAutomaticCapturedAtMsV1(anchor, rebootSample)).toBeNull();
    expect(deriveAutomaticExpiryNowMsV1(anchor, rebootSample)).toBeNull();

    const refreshed = {
      ...anchor,
      bootId: "boot-b",
      monotonicTimeMs: 100,
      serverTimeMs: anchor.serverTimeMs + 1000,
      wallTimeMs: anchor.wallTimeMs + 1000,
    };
    expect(deriveAutomaticCapturedAtMsV1(refreshed, rebootSample)).toBe(
      refreshed.serverTimeMs
    );
  });

  // refreshed reboot evaluation
  it("evaluates queued records only after a refreshed reboot anchor", () => {
    const refreshed = clockFixture.refreshedReboot;
    const trustedNowMs = deriveAutomaticExpiryNowMsV1(
      refreshed.anchor,
      refreshed.sample
    );
    expect(trustedNowMs).toBe(refreshed.expectedExpiryNowMs);
    expect(
      isAutomaticCandidateExpiredV1(
        refreshed.queuedCapturedAtMs,
        trustedNowMs as number
      )
    ).toBe(refreshed.expired);
  });

  // exact local expiry
  it("retains at 11:59:59.999 and expires at 12:00:00.000", () => {
    expect(
      isAutomaticCandidateExpiredV1(
        1000,
        1000 + AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS - 1
      )
    ).toBe(false);
    expect(
      isAutomaticCandidateExpiredV1(
        1000,
        1000 + AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS
      )
    ).toBe(true);
  });
});

describe("automatic server time and queue policy", () => {
  // database future boundary
  it("admits equality and rejects one millisecond beyond future tolerance", () => {
    const dbNowMs = 1720000000000;
    expect(classifyAutomaticCandidateServerTimeV1(dbNowMs, dbNowMs, 0)).toBe(
      "admitted"
    );
    expect(
      classifyAutomaticCandidateServerTimeV1(dbNowMs + 1, dbNowMs, 0)
    ).toBe("future_timestamp");
    expect(
      classifyAutomaticCandidateServerTimeV1(dbNowMs + 30000, dbNowMs, 30000)
    ).toBe("admitted");
    expect(
      classifyAutomaticCandidateServerTimeV1(dbNowMs + 30001, dbNowMs, 30000)
    ).toBe("future_timestamp");
  });

  // database expiry boundary
  it("expires against the injected database time at exactly twelve hours", () => {
    const capturedAtMs = 1720000000000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("untrusted wall clock read");
    });
    expect(
      classifyAutomaticCandidateServerTimeV1(
        capturedAtMs,
        capturedAtMs + AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS - 1,
        0
      )
    ).toBe("admitted");
    expect(
      classifyAutomaticCandidateServerTimeV1(
        capturedAtMs,
        capturedAtMs + AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
        0
      )
    ).toBe("expired");
    dateNow.mockRestore();
  });

  // configured queue capacity
  it("drops oldest-expiring candidates without a hard-coded capacity", () => {
    const orderedIds = [
      "AAAAAAAAAAAAAAAAAAAAAA",
      "AAECAwQFBgcICQoLDA0ODw",
      "EBESExQVFhcYGRobHB0eHw",
      "_____________________w",
    ];
    const candidates = [
      candidate(orderedIds[2], 3000),
      candidate(orderedIds[0], 1000),
      candidate(orderedIds[3], 4000),
      candidate(orderedIds[1], 2000),
    ];
    const result = applyAutomaticQueueCapacityV1(candidates, 2);
    expect(result.dropped.map(({ candidateId }) => candidateId)).toEqual(
      orderedIds.slice(0, 2)
    );
    expect(result.retained.map(({ candidateId }) => candidateId)).toEqual(
      orderedIds.slice(2)
    );
    expect(applyAutomaticQueueCapacityV1(candidates, 3).retained).toHaveLength(
      3
    );
  });

  // same-terminal head selection
  it("selects the oldest terminal head by capture time and candidate ID", () => {
    const oldestById = candidate("AAAAAAAAAAAAAAAAAAAAAA", 1000, "7");
    const laterId = candidate("AAECAwQFBgcICQoLDA0ODw", 1000, "7");
    const laterTime = candidate("EBESExQVFhcYGRobHB0eHw", 1001, "7");

    expect(
      selectAutomaticCandidateUploadHeadsV1([laterTime, laterId, oldestById])
    ).toEqual([oldestById]);
  });

  // retryable lane isolation
  it("blocks newer retryable terminal work without blocking other entities", () => {
    const retryableHead = candidate("AAAAAAAAAAAAAAAAAAAAAA", 1000, "7");
    const newerSameTerminal = candidate("_____________________w", 4000, "7");
    const otherTerminal = candidate("EBESExQVFhcYGRobHB0eHw", 3000, "8");
    const vessel = vesselCandidate("AAECAwQFBgcICQoLDA0ODw", 2000);
    const queued = [newerSameTerminal, otherTerminal, retryableHead, vessel];
    const afterRetryable = [...queued];

    expect(selectAutomaticCandidateUploadHeadsV1(queued)).toEqual([
      retryableHead,
      vessel,
      otherTerminal,
    ]);
    expect(selectAutomaticCandidateUploadHeadsV1(afterRetryable)).toEqual([
      retryableHead,
      vessel,
      otherTerminal,
    ]);
    expect(
      selectAutomaticCandidateUploadHeadsV1(
        queued.filter(
          // remove only the finalized head
          ({ candidateId }) => candidateId !== retryableHead.candidateId
        )
      )
    ).toEqual([vessel, otherTerminal, newerSameTerminal]);
  });
});
