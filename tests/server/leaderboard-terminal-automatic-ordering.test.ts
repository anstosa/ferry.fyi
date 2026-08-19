import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedAutomaticTerminalConfig } from "../../server/services/leaderboardAutomaticNativeConfig";
import type {
  AutomaticCheckinOutcome,
  AutomaticTerminalCheckinCandidateV1,
} from "../../shared/contracts/leaderboards";

// hoist durable check-in seams
const checkins = vi.hoisted(() => ({ create: vi.fn() }));
// hoist current route-duration seams
const routes = vi.hoisted(() => ({ getByTerminalId: vi.fn() }));
// hoist immutable config module seams
const configService = vi.hoisted(() => {
  // model fixed durable config failures
  class AutomaticTerminalConfigError extends Error {}
  return {
    AutomaticTerminalConfigError,
    loadAutomaticTerminalConfigGeneration: vi.fn(),
  };
});

// isolate check-in persistence
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));
// isolate crossing-duration hydration
vi.mock("~/models/Route", () => ({ Route: routes }));
// preserve the server helper namespace under the mixed test alias
vi.mock("~/lib/leaderboards", () => import("../../server/lib/leaderboards"));
// avoid database startup for injected immutable config tests
vi.mock("~/services/leaderboardAutomaticNativeConfig", () => configService);

import type {
  LeaderboardAutomaticCandidateProofContext,
  LeaderboardAutomaticCandidateProofEvaluator,
} from "../../server/services/leaderboardAutomaticCandidateReceipts";
import {
  AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS,
  createLeaderboardAutomaticTerminalProofEvaluator,
} from "../../server/services/leaderboardAutomaticTerminalProof";

const terminalId = "7";
const secondTerminalId = "8";
const subject = "auth0|terminal-ordering";
const transaction = { id: "terminal-ordering-transaction" };
const baseTimeMs = Date.parse("2026-08-18T00:00:00.000Z");
const cooldownMs = 40 * 60_000;

interface PresenceFixture {
  exitedAt: Date | null;
  lastCreditedAt: Date | null;
  lastObservedAt: Date | null;
  subject: string;
  terminalId: string;
  update: ReturnType<typeof vi.fn>;
}

// build one immutable retained generation
const config = (
  configGeneration = 4,
  activatedAtMs = baseTimeMs - 1
): LoadedAutomaticTerminalConfig => ({
  activatedAt: new Date(activatedAtMs),
  configGeneration,
  contentHash: "a".repeat(64),
  generatedAt: new Date(activatedAtMs),
  regionJson: "[]",
  regions: [
    {
      configGeneration,
      latitudeE7: 476_000_000,
      longitudeE7: -1_224_000_000,
      radiusMillimeters: 304_800,
      terminalId,
    },
    {
      configGeneration,
      latitudeE7: 477_000_000,
      longitudeE7: -1_225_000_000,
      radiusMillimeters: 304_800,
      terminalId: secondTerminalId,
    },
  ],
  retainUntil: new Date(baseTimeMs + 24 * 60 * 60_000),
  schemaVersion: 1,
});

// build one strict terminal candidate
const candidate = (
  capturedAtMs: number,
  overrides: Partial<AutomaticTerminalCheckinCandidateV1> = {}
): AutomaticTerminalCheckinCandidateV1 => ({
  accuracyMillimeters: 10_000,
  candidateId: `candidate-${capturedAtMs}-${overrides.terminalId ?? terminalId}`,
  capturedAtMs,
  configGeneration: 4,
  kind: "terminal",
  latitudeE7: 476_000_000,
  longitudeE7: -1_224_000_000,
  schemaVersion: 1,
  terminalId,
  ...overrides,
});

// build mutable persisted chronology
const presence = (
  overrides: Partial<Omit<PresenceFixture, "update">> = {}
): PresenceFixture => {
  const value = {
    exitedAt: null,
    lastCreditedAt: null,
    lastObservedAt: null,
    subject,
    terminalId,
    ...overrides,
  } as PresenceFixture;
  value.update = vi.fn((update: Partial<PresenceFixture>) => {
    // mirror one committed model update
    Object.assign(value, update);
    return Promise.resolve(value);
  });
  return value;
};

// build one already-locked proof context
const context = (
  value: AutomaticTerminalCheckinCandidateV1,
  presences: PresenceFixture[]
): LeaderboardAutomaticCandidateProofContext =>
  ({
    candidate: value,
    dbNow: new Date(value.capturedAtMs + 1_000),
    enrollment: { subject },
    policy: { presences, transaction },
  }) as unknown as LeaderboardAutomaticCandidateProofContext;

// evaluate one event against the supplied chronology
const evaluate = async (
  evaluator: LeaderboardAutomaticCandidateProofEvaluator,
  value: AutomaticTerminalCheckinCandidateV1,
  state: PresenceFixture
) => await evaluator(context(value, [state]));

// cover the shared automatic chronology contract
describe("automatic terminal ordering", () => {
  let checkinId: number;
  let loadConfig: ReturnType<typeof vi.fn>;
  let evaluator: LeaderboardAutomaticCandidateProofEvaluator;

  // reset isolated chronology dependencies
  beforeEach(() => {
    vi.clearAllMocks();
    checkinId = 0;
    checkins.create.mockImplementation(() =>
      Promise.resolve({ id: ++checkinId })
    );
    routes.getByTerminalId.mockReturnValue({
      route: { crossingTime: 20 },
    });
    loadConfig = vi.fn(() => Promise.resolve(config()));
    evaluator = createLeaderboardAutomaticTerminalProofEvaluator({
      loadConfig,
    });
  });

  // prove entry, exit, and equality re-entry use event time
  it("uses captured event time for entry, exit, and exact-exit re-entry", async () => {
    const state = presence();
    const entryAtMs = baseTimeMs;
    const exitAtMs = entryAtMs + cooldownMs;

    await expect(
      evaluate(evaluator, candidate(entryAtMs), state)
    ).resolves.toMatchObject({
      credited: true,
      outcome: "credited",
    });
    expect(checkins.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ occurredAt: new Date(entryAtMs) }),
      { transaction }
    );
    expect(state).toMatchObject({
      exitedAt: null,
      lastCreditedAt: new Date(entryAtMs),
      lastObservedAt: new Date(entryAtMs),
    });

    const exit = candidate(exitAtMs, {
      candidateId: "automatic-exit",
      latitudeE7: 476_100_000,
    });
    await expect(evaluate(evaluator, exit, state)).resolves.toMatchObject({
      credited: false,
      outcome: "outside_terminal",
    });
    expect(state).toMatchObject({
      exitedAt: new Date(exitAtMs),
      lastObservedAt: new Date(exitAtMs),
    });

    const reentry = candidate(exitAtMs, { candidateId: "automatic-reentry" });
    await expect(evaluate(evaluator, reentry, state)).resolves.toMatchObject({
      credited: true,
      outcome: "credited",
    });
    expect(state).toMatchObject({
      exitedAt: null,
      lastCreditedAt: new Date(exitAtMs),
      lastObservedAt: new Date(exitAtMs),
    });

    await expect(evaluate(evaluator, reentry, state)).resolves.toMatchObject({
      credited: false,
      outcome: "stale_event",
    });
    expect(checkins.create).toHaveBeenCalledTimes(2);
  });

  // prove exact immutable generation binding
  it("loads the candidate generation and rejects missing or post-event config", async () => {
    const state = presence();
    const value = candidate(baseTimeMs, { configGeneration: 9 });
    loadConfig.mockResolvedValueOnce(config(9));

    await expect(evaluate(evaluator, value, state)).resolves.toMatchObject({
      outcome: "credited",
    });
    expect(loadConfig).toHaveBeenCalledWith(9, transaction);

    loadConfig.mockResolvedValueOnce(config(8));
    await expect(
      evaluate(
        evaluator,
        candidate(baseTimeMs + 1, {
          candidateId: "wrong-generation",
          configGeneration: 9,
        }),
        state
      )
    ).resolves.toMatchObject({ outcome: "terminal_config_unavailable" });

    loadConfig.mockResolvedValueOnce(config(9, baseTimeMs + 3));
    await expect(
      evaluate(
        evaluator,
        candidate(baseTimeMs + 2, {
          candidateId: "not-yet-active",
          configGeneration: 9,
        }),
        state
      )
    ).resolves.toMatchObject({ outcome: "terminal_config_unavailable" });
  });

  // prove strict older, equal, and newer boundaries
  it.each([
    ["older", -1, "stale_event"],
    ["equal", 0, "stale_event"],
    ["newer", 1, "credited"],
  ] as const)(
    "%s event follows the shared chronology boundary",
    async (_label, offsetMs, outcome) => {
      const observedAtMs = baseTimeMs;
      const state = presence({ lastObservedAt: new Date(observedAtMs) });
      const value = candidate(observedAtMs + offsetMs);

      await expect(evaluate(evaluator, value, state)).resolves.toMatchObject({
        outcome,
      });
      expect(state.lastObservedAt).toEqual(
        new Date(
          outcome === "credited" ? observedAtMs + offsetMs : observedAtMs
        )
      );
    }
  );

  // prove every explicit automatic re-entry invariant boundary
  it.each([
    ["no departure", baseTimeMs, null, baseTimeMs + cooldownMs, "stale_event"],
    [
      "departure older than credit",
      baseTimeMs,
      baseTimeMs - 1,
      baseTimeMs + cooldownMs,
      "stale_event",
    ],
    [
      "departure equal to credit",
      baseTimeMs,
      baseTimeMs,
      baseTimeMs + cooldownMs,
      "stale_event",
    ],
    [
      "departure after capture",
      baseTimeMs,
      baseTimeMs + cooldownMs + 1,
      baseTimeMs + cooldownMs,
      "stale_event",
    ],
    [
      "departure at capture",
      baseTimeMs,
      baseTimeMs + cooldownMs,
      baseTimeMs + cooldownMs,
      "credited",
    ],
    [
      "departure before later capture",
      baseTimeMs,
      baseTimeMs + 1,
      baseTimeMs + cooldownMs,
      "credited",
    ],
  ] as const)(
    "%s enforces lastCreditedAt < exitedAt <= capturedAt",
    async (_label, creditedAtMs, exitedAtMs, capturedAtMs, outcome) => {
      const lastObservedAtMs = exitedAtMs ?? creditedAtMs;
      const state = presence({
        exitedAt: exitedAtMs === null ? null : new Date(exitedAtMs),
        lastCreditedAt: new Date(creditedAtMs),
        lastObservedAt: new Date(lastObservedAtMs),
      });

      await expect(
        evaluate(evaluator, candidate(capturedAtMs), state)
      ).resolves.toMatchObject({ outcome });
    }
  );

  // prove cooldown equality is admitted but one millisecond early is not
  it("uses captured time at the exact cooldown edge", async () => {
    const lastCreditedAt = new Date(baseTimeMs);
    const exitedAt = new Date(baseTimeMs + 1);
    const before = presence({
      exitedAt,
      lastCreditedAt,
      lastObservedAt: exitedAt,
    });
    const exact = presence({
      exitedAt,
      lastCreditedAt,
      lastObservedAt: exitedAt,
    });

    await expect(
      evaluate(evaluator, candidate(baseTimeMs + cooldownMs - 1), before)
    ).resolves.toMatchObject({ outcome: "stale_event" });
    await expect(
      evaluate(evaluator, candidate(baseTimeMs + cooldownMs), exact)
    ).resolves.toMatchObject({ outcome: "credited" });
  });

  // prove cross-device stale exit cannot roll chronology backward
  it("rejects a delayed older exit after a newer device entry", async () => {
    const state = presence();
    const newerAtMs = baseTimeMs + 10_000;
    await expect(
      evaluate(evaluator, candidate(newerAtMs), state)
    ).resolves.toMatchObject({ outcome: "credited" });
    const updatesAfterNewer = state.update.mock.calls.length;

    await expect(
      evaluate(
        evaluator,
        candidate(baseTimeMs, {
          candidateId: "older-device-exit",
          latitudeE7: 476_100_000,
        }),
        state
      )
    ).resolves.toMatchObject({ outcome: "stale_event" });
    expect(state.update).toHaveBeenCalledTimes(updatesAfterNewer);
    expect(state.lastObservedAt).toEqual(new Date(newerAtMs));
    expect(state.exitedAt).toBeNull();
  });

  // prove one retryable terminal never creates a global chronology head
  it("keeps terminal work independent without a global ordering block", async () => {
    const first = presence();
    const second = presence({ terminalId: secondTerminalId });
    routes.getByTerminalId.mockImplementation((id: string) =>
      // warm only the second terminal route
      id === terminalId ? {} : { route: { crossingTime: 20 } }
    );
    const secondValue = candidate(baseTimeMs, {
      candidateId: "second-terminal",
      latitudeE7: 477_000_000,
      longitudeE7: -1_225_000_000,
      terminalId: secondTerminalId,
    });

    const [firstResult, secondResult] = await Promise.all([
      evaluate(evaluator, candidate(baseTimeMs), first),
      evaluator(context(secondValue, [second])),
    ]);
    expect(firstResult).toMatchObject({
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    expect(secondResult).toMatchObject({
      disposition: "final",
      outcome: "credited",
    });
    expect(first.lastObservedAt).toBeNull();
    expect(second.lastObservedAt).toEqual(new Date(baseTimeMs));
  });

  // prove the accuracy policy is complete and bounded
  it("rejects accuracy above the bound and a boundary-crossing circle", async () => {
    const state = presence();
    await expect(
      evaluate(
        evaluator,
        candidate(baseTimeMs, {
          accuracyMillimeters:
            AUTOMATIC_TERMINAL_MAX_LOCATION_ACCURACY_MILLIMETERS + 1,
        }),
        state
      )
    ).resolves.toMatchObject({ outcome: "location_accuracy_too_low" });
    await expect(
      evaluate(
        evaluator,
        candidate(baseTimeMs, {
          accuracyMillimeters: 100_000,
          latitudeE7: 476_027_400,
        }),
        state
      )
    ).resolves.toMatchObject({ outcome: "location_accuracy_too_low" });
    expect(state.update).not.toHaveBeenCalled();
  });

  // keep the fixed outcome union visible to acceptance assertions
  it("returns only declared automatic outcomes", async () => {
    const result = await evaluate(evaluator, candidate(baseTimeMs), presence());
    const { outcome }: { outcome: AutomaticCheckinOutcome } = result;
    expect(outcome).toBe("credited");
  });
});
