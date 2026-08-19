import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// hoist immutable config seams
const configService = vi.hoisted(() => {
  // represent fixed config validation failures
  class AutomaticTerminalConfigError extends Error {}
  return {
    AutomaticTerminalConfigError,
    loadAutomaticTerminalConfigGeneration: vi.fn(),
  };
});
// hoist persistence seams
const checkinModel = vi.hoisted(() => ({ create: vi.fn() }));
// hoist route-cache seams
const routeModel = vi.hoisted(() => ({ getByTerminalId: vi.fn() }));

// bind immutable config seams
vi.mock("~/services/leaderboardAutomaticNativeConfig", () => configService);
// bind check-in persistence seams
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkinModel,
}));
// bind route-cache seams
vi.mock("~/models/Route", () => ({ Route: routeModel }));

import type { LeaderboardAutomaticCandidateProofContext } from "../../server/services/leaderboardAutomaticCandidateReceipts";
import {
  AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
  createLeaderboardAutomaticTerminalProofEvaluator,
} from "../../server/services/leaderboardAutomaticTerminalProof";
import type {
  AutomaticCheckinCandidateV1,
  AutomaticTerminalCheckinCandidateV1,
} from "../../shared/contracts/leaderboards";

const capturedAtMs = Date.parse("2026-08-18T04:00:00.000Z");
const subject = "auth0|terminal-proof";

interface FakePresence {
  exitedAt: Date | null;
  lastCreditedAt: Date | null;
  lastObservedAt: Date | null;
  subject: string;
  terminalId: string;
  update: Mock;
}

// build one exact terminal candidate
const terminalCandidate = (
  overrides: Partial<AutomaticTerminalCheckinCandidateV1> = {}
): AutomaticTerminalCheckinCandidateV1 => ({
  accuracyMillimeters: 20_000,
  candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
  capturedAtMs,
  configGeneration: 7,
  kind: "terminal",
  latitudeE7: 473_000_000,
  longitudeE7: -1_225_000_000,
  schemaVersion: 1,
  terminalId: "7",
  ...overrides,
});

// build one vessel candidate
const vesselCandidate = (): AutomaticCheckinCandidateV1 => ({
  accuracyMillimeters: 20_000,
  candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
  capturedAtMs,
  kind: "vessel",
  latitudeE7: 473_000_000,
  longitudeE7: -1_225_000_000,
  sailingId: "vessel-1:1:7:8",
  schemaVersion: 1,
  vesselId: "vessel-1",
});

// build one mutable locked presence
const makePresence = (
  values: Partial<Omit<FakePresence, "update">> = {}
): FakePresence => {
  const presence = {
    exitedAt: null,
    lastCreditedAt: null,
    lastObservedAt: null,
    subject,
    terminalId: "7",
    ...values,
  } as FakePresence;
  // apply transaction-local chronology mutations
  presence.update = vi.fn((changes: Partial<FakePresence>) => {
    Object.assign(presence, changes);
    return Promise.resolve();
  });
  return presence;
};

// build one proof transaction context
const proofContext = (
  candidate: AutomaticCheckinCandidateV1,
  presence = makePresence()
): LeaderboardAutomaticCandidateProofContext =>
  ({
    candidate,
    dbNow: new Date(capturedAtMs + 1_000),
    enrollment: { subject },
    policy: {
      checkins: [],
      presences: [presence],
      transaction: { id: "transaction" },
    },
  }) as unknown as LeaderboardAutomaticCandidateProofContext;

// build one exact retained generation
const retainedConfig = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  activatedAt: new Date(capturedAtMs - 60 * 60_000),
  configGeneration: 7,
  contentHash: "a".repeat(64),
  generatedAt: new Date(capturedAtMs - 60 * 60_000),
  regionJson: "[]",
  regions: [
    {
      configGeneration: 7,
      latitudeE7: 473_000_000,
      longitudeE7: -1_225_000_000,
      radiusMillimeters: 304_800,
      terminalId: "7",
    },
  ],
  retainUntil: new Date(capturedAtMs + 24 * 60 * 60_000),
  schemaVersion: 1,
  ...overrides,
});

// verify immutable terminal proof and chronology
describe("automatic terminal proof", () => {
  // reset proof dependencies
  beforeEach(() => {
    vi.clearAllMocks();
    configService.loadAutomaticTerminalConfigGeneration.mockResolvedValue(
      retainedConfig()
    );
    checkinModel.create.mockResolvedValue({ id: 41 });
    routeModel.getByTerminalId.mockReturnValue({
      route: { crossingTime: 20 },
    });
  });

  // keep vessel production credit disabled
  it("returns a fixed non-crediting vessel result", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(proofContext(vesselCandidate()))).resolves.toEqual({
      credited: false,
      disposition: "final",
      outcome: "history_unavailable",
    });
    expect(
      configService.loadAutomaticTerminalConfigGeneration
    ).not.toHaveBeenCalled();
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // bind proof to exact durable generation bytes
  it("fails closed for missing, mismatched, future, or absent config regions", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    configService.loadAutomaticTerminalConfigGeneration.mockRejectedValueOnce(
      new configService.AutomaticTerminalConfigError("missing")
    );
    await expect(evaluate(proofContext(terminalCandidate()))).resolves.toEqual({
      credited: false,
      disposition: "final",
      outcome: "terminal_config_unavailable",
    });

    configService.loadAutomaticTerminalConfigGeneration.mockResolvedValueOnce(
      retainedConfig({ configGeneration: 8 })
    );
    await expect(
      evaluate(proofContext(terminalCandidate()))
    ).resolves.toMatchObject({ outcome: "terminal_config_unavailable" });

    configService.loadAutomaticTerminalConfigGeneration.mockResolvedValueOnce(
      retainedConfig({ activatedAt: new Date(capturedAtMs + 1) })
    );
    await expect(
      evaluate(proofContext(terminalCandidate()))
    ).resolves.toMatchObject({ outcome: "terminal_config_unavailable" });

    configService.loadAutomaticTerminalConfigGeneration.mockResolvedValueOnce(
      retainedConfig()
    );
    await expect(
      evaluate(proofContext(terminalCandidate({ terminalId: "999" })))
    ).resolves.toMatchObject({ outcome: "terminal_not_found" });
    expect(
      configService.loadAutomaticTerminalConfigGeneration
    ).toHaveBeenLastCalledWith(7, undefined, { id: "transaction" });
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // retain retryable work on transient config-store failures
  it("returns a fixed retryable result for config-store exceptions", async () => {
    configService.loadAutomaticTerminalConfigGeneration.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(proofContext(terminalCandidate()))).resolves.toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // retain retryable work if ordered presence state is unavailable
  it("returns a fixed retryable result for a missing proof lock", async () => {
    const context = proofContext(terminalCandidate());
    context.policy.presences = [];
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(context)).resolves.toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // require the whole accuracy circle on one side
  it("rejects excessive and boundary-crossing accuracy circles", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    await expect(
      evaluate(
        proofContext(
          terminalCandidate({
            accuracyMillimeters:
              AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS + 1,
          })
        )
      )
    ).resolves.toMatchObject({ outcome: "location_accuracy_too_low" });
    expect(
      configService.loadAutomaticTerminalConfigGeneration
    ).not.toHaveBeenCalled();

    await expect(
      evaluate(
        proofContext(
          terminalCandidate({
            longitudeE7: -1_224_960_000,
          })
        )
      )
    ).resolves.toMatchObject({ outcome: "location_accuracy_too_low" });
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // admit the exact versioned accuracy boundary
  it("accepts a definitive center fix at the maximum accuracy", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(
      evaluate(
        proofContext(
          terminalCandidate({
            accuracyMillimeters:
              AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
          })
        )
      )
    ).resolves.toMatchObject({ credited: true, outcome: "credited" });
  });

  // persist accepted outside event time without raw location
  it("records a definitive outside observation as final non-crediting", async () => {
    const presence = makePresence();
    const candidate = terminalCandidate({ longitudeE7: -1_224_000_000 });
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(proofContext(candidate, presence))).resolves.toEqual({
      credited: false,
      disposition: "final",
      outcome: "outside_terminal",
    });
    expect(presence.exitedAt?.getTime()).toBe(capturedAtMs);
    expect(presence.lastObservedAt?.getTime()).toBe(capturedAtMs);
    expect(presence.update).toHaveBeenCalledWith(
      {
        exitedAt: new Date(capturedAtMs),
        lastObservedAt: new Date(capturedAtMs),
      },
      { transaction: { id: "transaction" } }
    );
    expect(JSON.stringify(presence.update.mock.calls)).not.toContain(
      String(candidate.latitudeE7)
    );
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // write event-time entry and one durable check-in
  it("credits one definitive inside entry at captured event time", async () => {
    const presence = makePresence();
    const candidate = terminalCandidate();
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(proofContext(candidate, presence))).resolves.toEqual({
      checkinId: 41,
      credited: true,
      disposition: "final",
      outcome: "credited",
    });
    expect(checkinModel.create).toHaveBeenCalledWith(
      {
        entityId: "7",
        kind: "terminal",
        occurredAt: new Date(capturedAtMs),
        sailingId: null,
        subject,
      },
      { transaction: { id: "transaction" } }
    );
    expect(presence).toMatchObject({
      exitedAt: null,
      lastCreditedAt: new Date(capturedAtMs),
      lastObservedAt: new Date(capturedAtMs),
    });
  });

  // reject older and conflicting equal observations
  it("never rolls chronology backward", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    const newer = new Date(capturedAtMs + 1);
    const olderPresence = makePresence({ lastObservedAt: newer });
    await expect(
      evaluate(proofContext(terminalCandidate(), olderPresence))
    ).resolves.toMatchObject({ outcome: "stale_event" });

    const equalOutsidePresence = makePresence({
      exitedAt: new Date(capturedAtMs),
      lastObservedAt: new Date(capturedAtMs),
    });
    await expect(
      evaluate(
        proofContext(
          terminalCandidate({ longitudeE7: -1_224_000_000 }),
          equalOutsidePresence
        )
      )
    ).resolves.toMatchObject({ outcome: "stale_event" });

    const inconsistentPresence = makePresence({
      exitedAt: new Date(capturedAtMs + 1),
      lastObservedAt: null,
    });
    await expect(
      evaluate(proofContext(terminalCandidate(), inconsistentPresence))
    ).resolves.toMatchObject({ outcome: "stale_event" });
    expect(olderPresence.update).not.toHaveBeenCalled();
    expect(equalOutsidePresence.update).not.toHaveBeenCalled();
    expect(inconsistentPresence.update).not.toHaveBeenCalled();
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // allow the sole specified equal exit-entry pairing
  it("allows equal-time entry after stored exit only once", async () => {
    const presence = makePresence({
      exitedAt: new Date(capturedAtMs),
      lastCreditedAt: new Date(capturedAtMs - 60 * 60_000),
      lastObservedAt: new Date(capturedAtMs),
    });
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    const context = proofContext(terminalCandidate(), presence);

    await expect(evaluate(context)).resolves.toMatchObject({
      credited: true,
      outcome: "credited",
    });
    await expect(evaluate(context)).resolves.toMatchObject({
      credited: false,
      outcome: "stale_event",
    });
    expect(checkinModel.create).toHaveBeenCalledOnce();
  });

  // enforce departure chronology and cooldown at event time
  it("requires a valid departure and accepts the exact cooldown boundary", async () => {
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    const noExit = makePresence({
      lastCreditedAt: new Date(capturedAtMs - 60 * 60_000),
      lastObservedAt: new Date(capturedAtMs - 60 * 60_000),
    });
    await expect(
      evaluate(proofContext(terminalCandidate(), noExit))
    ).resolves.toMatchObject({ outcome: "stale_event" });

    const cooldown = makePresence({
      exitedAt: new Date(capturedAtMs - 1_000),
      lastCreditedAt: new Date(capturedAtMs - 40 * 60_000 + 1),
      lastObservedAt: new Date(capturedAtMs - 1_000),
    });
    await expect(
      evaluate(proofContext(terminalCandidate(), cooldown))
    ).resolves.toMatchObject({ outcome: "stale_event" });

    const boundary = makePresence({
      exitedAt: new Date(capturedAtMs - 1_000),
      lastCreditedAt: new Date(capturedAtMs - 40 * 60_000),
      lastObservedAt: new Date(capturedAtMs - 1_000),
    });
    await expect(
      evaluate(proofContext(terminalCandidate(), boundary))
    ).resolves.toMatchObject({ credited: true, outcome: "credited" });
  });

  // keep retryable head-of-line work while route data warms
  it("retries an otherwise valid entry when route duration is unavailable", async () => {
    routeModel.getByTerminalId.mockReturnValue({});
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();

    await expect(evaluate(proofContext(terminalCandidate()))).resolves.toEqual({
      credited: false,
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    expect(checkinModel.create).not.toHaveBeenCalled();
  });

  // keep separate terminal proof state independent
  it("processes different terminal candidates without shared chronology", async () => {
    const secondRegion = {
      configGeneration: 7,
      latitudeE7: 474_000_000,
      longitudeE7: -1_226_000_000,
      radiusMillimeters: 304_800,
      terminalId: "8",
    };
    configService.loadAutomaticTerminalConfigGeneration.mockResolvedValue(
      retainedConfig({
        regions: [
          ...(retainedConfig().regions as Record<string, unknown>[]),
          secondRegion,
        ],
      })
    );
    const firstPresence = makePresence();
    const secondPresence = makePresence({ terminalId: "8" });
    const evaluate = createLeaderboardAutomaticTerminalProofEvaluator();
    const first = evaluate(proofContext(terminalCandidate(), firstPresence));
    const second = evaluate(
      proofContext(
        terminalCandidate({
          candidateId: "BAAAAAAAAAAAAAAAAAAAAA",
          latitudeE7: secondRegion.latitudeE7,
          longitudeE7: secondRegion.longitudeE7,
          terminalId: "8",
        }),
        secondPresence
      )
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ credited: true }),
      expect.objectContaining({ credited: true }),
    ]);
    expect(firstPresence.lastObservedAt?.getTime()).toBe(capturedAtMs);
    expect(secondPresence.lastObservedAt?.getTime()).toBe(capturedAtMs);
    expect(checkinModel.create).toHaveBeenCalledTimes(2);
  });
});
