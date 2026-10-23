import { describe, expect, it, vi } from "vitest";

import type { OpenaiCameraPreparedFrame } from "../../server/lib/openaiCameraImages";
import {
  type OpenaiCameraDeparture,
  OpenaiCameraPipeline,
} from "../../server/lib/openaiCameraPipeline";
import { getOpenaiCameraDefinitions } from "../../server/lib/openaiCameraPlanning";
import type { OpenaiCameraStore } from "../../server/lib/openaiCameraStore";
import type {
  OpenaiCameraDefinition,
  OpenaiCameraImageResult,
  OpenaiCameraObservation,
  OpenaiCameraOccupancy,
  OpenaiCameraPipelineState,
  OpenaiCameraPromptImage,
} from "../../server/lib/openaiCameraTypes";

const SLOT = 5 * 60_000;
const BASE = Date.UTC(2026, 9, 23, 10, 0, 0);
const catalog = getOpenaiCameraDefinitions();
const clinton = catalog.filter(({ terminalId }) => terminalId === "5");
const mukilteo = catalog.filter(({ terminalId }) => terminalId === "14");

// copy persisted state across every fake-store boundary
const clone = (state: OpenaiCameraPipelineState): OpenaiCameraPipelineState =>
  structuredClone(state);

// create the durable scheduler baseline without importing store implementation
const emptyState = (): OpenaiCameraPipelineState => ({
  version: 1,
  lastStartedSlot: null,
  lastCompletedAt: null,
  cameras: {},
  terminals: {},
});

// simulate monotonic claims, detached snapshots, and stale-owner fencing
class MemoryStore implements OpenaiCameraStore {
  private state: OpenaiCameraPipelineState;
  readonly saves: OpenaiCameraPipelineState[] = [];

  // detach caller-owned fixture state
  constructor(initial: OpenaiCameraPipelineState = emptyState()) {
    this.state = clone(initial);
  }

  // return a detached persisted snapshot
  read(): Promise<OpenaiCameraPipelineState> {
    return Promise.resolve(clone(this.state));
  }

  // claim only newer wall-clock slots
  beginRound(slot: number): Promise<OpenaiCameraPipelineState | null> {
    // reject duplicate and stale restarts
    if (
      this.state.lastStartedSlot !== null &&
      slot <= this.state.lastStartedSlot
    ) {
      return Promise.resolve(null);
    }
    this.state = clone({ ...this.state, lastStartedSlot: slot });
    return Promise.resolve(clone(this.state));
  }

  // persist only the current owner and capture every intermediate attempt
  save(state: OpenaiCameraPipelineState): Promise<void> {
    // fence work that crossed into a newer claimed round
    if (state.lastStartedSlot !== this.state.lastStartedSlot) {
      return Promise.reject(new Error("newer round owns state"));
    }
    this.state = clone(state);
    this.saves.push(clone(state));
    return Promise.resolve();
  }
}

// generate a complete provider result for every annotated section
const resultFor = (
  definition: OpenaiCameraDefinition,
  occupancyState: OpenaiCameraOccupancy | null = "empty",
  passing = false,
  visibilityProblems = false
): OpenaiCameraImageResult => ({
  cameraId: definition.cameraId,
  visibilityProblems,
  // preserve all supplied section identities
  lanes: definition.config.allowedAreas.map(({ id }) => ({
    cameraId: definition.cameraId,
    laneId: id,
    skippedDueToVisibility: visibilityProblems || occupancyState === null,
    occupancyState: visibilityProblems ? null : occupancyState,
    passing: visibilityProblems || occupancyState === null ? null : passing,
  })),
});

// create one previously classified camera observation
const observation = (
  definition: OpenaiCameraDefinition,
  checkedAt: number,
  occupancyState: OpenaiCameraOccupancy | null,
  options: {
    passing?: boolean;
    visibilityProblems?: boolean;
    frameToken?: string;
    fingerprint?: string;
    inferenceKey?: string;
    frameUnchangedSince?: number;
  } = {}
): OpenaiCameraObservation => {
  const result = resultFor(
    definition,
    occupancyState,
    options.passing,
    options.visibilityProblems
  );
  return {
    cameraId: definition.cameraId,
    checkedAt,
    inferredAt: checkedAt,
    frameUpdatedAt: checkedAt,
    frameUnchangedSince: options.frameUnchangedSince ?? checkedAt,
    frameToken: options.frameToken ?? `old-token-${definition.cameraId}`,
    fingerprint:
      options.fingerprint ?? `old-fingerprint-${definition.cameraId}`,
    inferenceKey: options.inferenceKey ?? "model-a:prompt-a",
    lastSubmittedSlot: checkedAt,
    result,
    lanes: [],
    error: null,
    freshness: "fresh",
    reused: false,
  };
};

// seed a due terminal with reliable prior queue evidence
const seededState = (
  definitions: OpenaiCameraDefinition[],
  now: number,
  tailCameraId: string | null,
  occupancies: Record<string, OpenaiCameraOccupancy | null>,
  options: Record<
    string,
    { passing?: boolean; visibilityProblems?: boolean }
  > = {}
): OpenaiCameraPipelineState => {
  const state = emptyState();
  state.lastStartedSlot = now - SLOT;
  state.lastCompletedAt = now - SLOT;
  // establish every camera as recently and reliably classified
  for (const definition of definitions) {
    state.cameras[definition.cameraId] = observation(
      definition,
      now - SLOT,
      occupancies[definition.cameraId] ?? "empty",
      options[definition.cameraId]
    );
  }
  state.terminals[definitions[0].terminalId] = {
    lastCheckedAt: now - SLOT,
    lastFullScanAt: now - SLOT,
    nextCheckAt: now,
    tailCameraId,
    stableRounds: 0,
    uncertain: false,
    coverage: "full",
    coveredCameraIds: definitions.map(({ cameraId }) => cameraId),
    errors: [],
  };
  return state;
};

interface HarnessOptions {
  definitions?: OpenaiCameraDefinition[];
  initial?: OpenaiCameraPipelineState;
  now?: number;
}

// create one departure with explicit time and optional service eligibility
const departure = (
  terminalId: string,
  predictedDepartureAt: number,
  eligibility: Partial<
    Pick<OpenaiCameraDeparture, "allowsVehicles" | "isCancelled">
  > = {}
): OpenaiCameraDeparture => ({
  terminalId,
  predictedDepartureAt,
  allowsVehicles: true,
  isCancelled: false,
  ...eligibility,
});

// build a fully mocked pipeline with mutable time and camera fixtures
const harness = (options: HarnessOptions = {}) => {
  const definitions = options.definitions ?? clinton;
  const store = new MemoryStore(options.initial);
  let now = options.now ?? BASE;
  let prepareSequence = 0;
  const initialNow = now;
  // keep ordinary test rounds inside active vehicle service
  let departures: OpenaiCameraDeparture[] = [
    ...new Set(definitions.map(({ terminalId }) => terminalId)),
  ].map((terminalId) => departure(terminalId, initialNow + 30 * 60_000));
  const fingerprints: Record<string, string> = {};
  const frameTokens: Record<string, string> = {};
  const frameUpdatedAts: Record<string, number | null> = {};
  const results: Record<string, OpenaiCameraImageResult> = {};
  const prepare = vi.fn(
    // emulate fresh preprocessed frames without network or raw image bytes
    (
      definition: OpenaiCameraDefinition
    ): Promise<OpenaiCameraPreparedFrame> => {
      prepareSequence += 1;
      return Promise.resolve({
        frameToken:
          frameTokens[definition.cameraId] ??
          `token-${definition.cameraId}-${now}-${prepareSequence}`,
        frameUpdatedAt:
          definition.cameraId in frameUpdatedAts
            ? frameUpdatedAts[definition.cameraId]
            : now,
        image: {
          cameraId: definition.cameraId,
          fingerprint:
            fingerprints[definition.cameraId] ??
            `fingerprint-${definition.cameraId}`,
          height: 100,
          imageBase64: "cHJlcGFyZWQ=",
          laneIds: definition.config.allowedAreas.map(({ id }) => id),
          rotationDegrees: 0,
          sourceHeight: 100,
          sourceWidth: 100,
          width: 100,
        },
      });
    }
  );
  const classify = vi.fn(
    // return deterministic classifications for the exact submitted identities
    (images: OpenaiCameraPromptImage[]): Promise<OpenaiCameraImageResult[]> =>
      Promise.resolve(
        images.map(
          (image) =>
            results[image.cameraId] ??
            resultFor(
              definitions.find(({ cameraId }) => cameraId === image.cameraId)!,
              "empty"
            )
        )
      )
  );
  // construct independent pipeline instances to simulate process restarts
  const createPipeline = (inferenceKey = "model-a:prompt-a") =>
    new OpenaiCameraPipeline({
      definitions,
      store,
      inferenceKey,
      prepare,
      classify,
      getDepartures: () => departures,
      getNow: () => now,
    });

  return {
    classify,
    createPipeline,
    definitions,
    fingerprints,
    frameTokens,
    frameUpdatedAts,
    prepare,
    results,
    store,
    // replace current predicted departures between rounds
    setDepartures(value: typeof departures) {
      departures = value;
    },
    // move the injected wall clock without fake timers
    setNow(value: number) {
      now = value;
    },
  };
};

// extract submitted camera identities from provider calls
const submittedIds = (mock: ReturnType<typeof vi.fn>): string[][] =>
  mock.mock.calls.map(([images]) =>
    (images as OpenaiCameraPromptImage[]).map(({ cameraId }) => cameraId)
  );

describe("OpenAI camera pipeline", () => {
  // prove one initial paid batch spans every due terminal
  it("groups cold-start full scans across terminals into one prompt", async () => {
    const definitions = [...clinton.slice(0, 2), ...mukilteo.slice(0, 2)];
    const context = harness({ definitions });

    const state = await context.createPipeline().run();

    expect(context.classify).toHaveBeenCalledTimes(1);
    expect(submittedIds(context.classify)).toEqual([
      definitions.map(({ cameraId }) => cameraId),
    ]);
    expect(state?.terminals[clinton[0].terminalId]).toMatchObject({
      coverage: "full",
      uncertain: false,
    });
    expect(state?.terminals[mukilteo[0].terminalId]).toMatchObject({
      coverage: "full",
      uncertain: false,
    });
  });

  // enforce the narrow startup window and next clock-slot eligibility
  it("starts only in the first thirty seconds of a clock slot", async () => {
    const context = harness({
      definitions: clinton.slice(0, 1),
      now: BASE + 30_001,
    });

    await expect(context.createPipeline().run()).resolves.toBeNull();
    expect(context.prepare).not.toHaveBeenCalled();

    context.setNow(BASE + SLOT);
    await expect(context.createPipeline().run()).resolves.not.toBeNull();
    expect(context.classify).toHaveBeenCalledTimes(1);
  });

  // ensure a restart cannot replay a slot already claimed durably
  it("rejects a duplicate same-slot run after process restart", async () => {
    const context = harness({ definitions: clinton.slice(0, 1) });

    await context.createPipeline().run();
    await expect(context.createPipeline().run()).resolves.toBeNull();

    expect(context.classify).toHaveBeenCalledTimes(1);
    expect(context.prepare).toHaveBeenCalledTimes(1);
  });

  // avoid camera and model spend when no vehicle service is active
  it("does no overnight work when the service window has no departures", async () => {
    const context = harness({ definitions: clinton.slice(0, 2) });
    context.setDepartures([]);

    const state = await context.createPipeline().run();

    expect(state?.terminals).toEqual({});
    expect(context.prepare).not.toHaveBeenCalled();
    expect(context.classify).not.toHaveBeenCalled();
  });

  // allow a source token change to prove freshness while lane pixels remain equal
  it("reuses unchanged lane fingerprints during a required full scan", async () => {
    const definitions = clinton.slice(0, 2);
    const context = harness({ definitions });
    await context.createPipeline().run();
    context.classify.mockClear();
    context.prepare.mockClear();
    context.setNow(BASE + SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 2 * SLOT),
    ]);

    const state = await context.createPipeline().run();

    expect(context.prepare).toHaveBeenCalledTimes(definitions.length);
    expect(context.classify).not.toHaveBeenCalled();
    expect(
      definitions.map(({ cameraId }) => state?.cameras[cameraId].reused)
    ).toEqual([true, true]);
    expect(state?.terminals[definitions[0].terminalId].lastFullScanAt).toBe(
      BASE + SLOT
    );
  });

  // require confirmed source freshness before a cold scan can bound a queue
  it("keeps headerless and future-dated cold scans incomplete", async () => {
    const definitions = clinton.slice(0, 2);
    const context = harness({ definitions });
    context.frameUpdatedAts[definitions[0].cameraId] = null;
    context.frameUpdatedAts[definitions[1].cameraId] = BASE + 2 * 60_000;
    context.results[definitions[0].cameraId] = resultFor(
      definitions[0],
      "high"
    );
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      "high"
    );

    const state = await context.createPipeline().run();

    expect(context.classify).toHaveBeenCalledTimes(1);
    expect(
      definitions.map(({ cameraId }) => state?.cameras[cameraId].freshness)
    ).toEqual(["unknown", "unknown"]);
    expect(state?.terminals[definitions[0].terminalId]).toMatchObject({
      lastFullScanAt: null,
      tailCameraId: null,
      uncertain: true,
    });
  });

  // establish freshness after a recent headerless source token advances
  it("accepts a recent headerless token advance on the second check", async () => {
    const definitions = clinton.slice(0, 1);
    const { cameraId } = definitions[0];
    const context = harness({ definitions });
    context.frameUpdatedAts[cameraId] = null;
    context.frameTokens[cameraId] = "headerless-first";

    const first = await context.createPipeline().run();
    expect(first?.cameras[cameraId].freshness).toBe("unknown");
    expect(
      first?.terminals[definitions[0].terminalId].lastFullScanAt
    ).toBeNull();

    context.classify.mockClear();
    context.setNow(BASE + SLOT);
    context.frameTokens[cameraId] = "headerless-second";
    const second = await context.createPipeline().run();

    expect(context.classify).not.toHaveBeenCalled();
    expect(second?.cameras[cameraId]).toMatchObject({
      freshness: "fresh",
      reused: true,
    });
    expect(second?.terminals[definitions[0].terminalId]).toMatchObject({
      lastFullScanAt: BASE + SLOT,
      uncertain: false,
    });
  });

  // prove current predicted time bypasses stable backoff at its final tick
  it("runs a predeparture full scan from predicted time despite backoff", async () => {
    const definitions = clinton.slice(0, 3);
    const context = harness({ definitions });
    await context.createPipeline().run();
    context.setNow(BASE + SLOT);
    await context.createPipeline().run();
    expect(
      (await context.store.read()).terminals[definitions[0].terminalId]
        .nextCheckAt
    ).toBe(BASE + 3 * SLOT);
    context.prepare.mockClear();
    context.setNow(BASE + 2 * SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 2 * SLOT + 3 * 60_000),
    ]);

    const state = await context.createPipeline().run();

    expect(context.prepare).toHaveBeenCalledTimes(definitions.length);
    expect(state?.terminals[definitions[0].terminalId]).toMatchObject({
      coverage: "full",
      lastFullScanAt: BASE + 2 * SLOT,
    });
  });

  // reevaluate the mandatory final tick after a later delay prediction
  it("rescans the new final tick when a 10:03 sailing moves to 10:10", async () => {
    const definitions = clinton.slice(0, 2);
    const initial = seededState(definitions, BASE, null, {});
    const context = harness({ definitions, initial });
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 3 * 60_000),
    ]);

    const first = await context.createPipeline().run();
    expect(first?.terminals[definitions[0].terminalId]).toMatchObject({
      lastFullScanAt: BASE,
      nextCheckAt: BASE + 2 * SLOT,
    });
    context.prepare.mockClear();
    context.classify.mockClear();
    context.setNow(BASE + SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 2 * SLOT),
    ]);

    const delayed = await context.createPipeline().run();

    expect(context.prepare).toHaveBeenCalledTimes(definitions.length);
    expect(context.classify).not.toHaveBeenCalled();
    expect(delayed?.terminals[definitions[0].terminalId]).toMatchObject({
      coverage: "full",
      lastFullScanAt: BASE + SLOT,
      uncertain: false,
    });
  });

  // preserve slot-based eligibility after a one-minute follow-up
  it("allows a 10:01 follow-up camera to run again at 10:05", async () => {
    const definitions = clinton.slice(0, 4);
    const state = seededState(definitions, BASE, definitions[1].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "high",
      [definitions[2].cameraId]: "empty",
      [definitions[3].cameraId]: "empty",
    });
    const context = harness({ definitions, initial: state });
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      "high"
    );
    context.results[definitions[2].cameraId] = resultFor(
      definitions[2],
      "high"
    );
    context.results[definitions[3].cameraId] = resultFor(
      definitions[3],
      "empty"
    );
    context.classify.mockImplementationOnce(
      // let serial follow-ups occur one minute into the original slot
      (images: OpenaiCameraPromptImage[]) => {
        context.setNow(BASE + 60_000);
        return Promise.resolve(
          images.map((image) => context.results[image.cameraId])
        );
      }
    );

    await context.createPipeline().run();
    expect(submittedIds(context.classify)).toEqual([
      [definitions[1].cameraId],
      [definitions[2].cameraId],
      [definitions[3].cameraId],
    ]);
    context.setNow(BASE + SLOT);
    context.fingerprints[definitions[2].cameraId] = "changed-at-next-slot";
    context.classify.mockClear();

    await context.createPipeline().run();

    expect(submittedIds(context.classify)[0]).toEqual([
      definitions[2].cameraId,
    ]);
    expect(
      (await context.store.read()).cameras[definitions[2].cameraId]
        .lastSubmittedSlot
    ).toBe(BASE + SLOT);
  });

  // distinguish countable changes and cache-version changes from overlay-only changes
  it("invalidates reuse for lane, geometry, model, and prompt changes", async () => {
    const definitions = clinton.slice(0, 1);
    const [{ cameraId }] = definitions;
    const context = harness({ definitions });
    await context.createPipeline().run();
    context.classify.mockClear();

    context.setNow(BASE + SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 2 * SLOT),
    ]);
    await context.createPipeline().run();
    expect(context.classify).not.toHaveBeenCalled();

    context.setNow(BASE + 2 * SLOT);
    context.fingerprints[cameraId] = "lane-or-geometry-changed";
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 3 * SLOT),
    ]);
    await context.createPipeline().run();
    expect(context.classify).toHaveBeenCalledTimes(1);

    context.classify.mockClear();
    context.setNow(BASE + 3 * SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 4 * SLOT),
    ]);
    await context.createPipeline("model-b:prompt-b").run();
    expect(context.classify).toHaveBeenCalledTimes(1);
    expect((await context.store.read()).cameras[cameraId].inferenceKey).toBe(
      "model-b:prompt-b"
    );
  });

  // walk outward one image per prompt until growth is bounded by a clear marker
  it("grows the prior queue tail with serial single-image follow-ups", async () => {
    const definitions = clinton.slice(0, 4);
    const state = seededState(definitions, BASE, definitions[1].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "high",
      [definitions[2].cameraId]: "empty",
      [definitions[3].cameraId]: "empty",
    });
    const context = harness({ definitions, initial: state });
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      "high"
    );
    context.results[definitions[2].cameraId] = resultFor(definitions[2], "low");
    context.results[definitions[3].cameraId] = resultFor(
      definitions[3],
      "empty"
    );

    const current = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual([
      [definitions[1].cameraId],
      [definitions[2].cameraId],
      [definitions[3].cameraId],
    ]);
    expect(current?.terminals[definitions[0].terminalId].tailCameraId).toBe(
      definitions[2].cameraId
    );
  });

  // finish both views before accepting a paired marker as a clear queue boundary
  it("continues past a clear first view to the queued paired view and outer marker", async () => {
    const definitions = mukilteo;
    const [anchor, firstView, secondView, outer] = definitions;
    expect([firstView.cameraId, secondView.cameraId]).toEqual(["9394", "9728"]);
    const initial = seededState(definitions, BASE, anchor.cameraId, {
      [anchor.cameraId]: "high",
    });
    const context = harness({ definitions, initial });
    context.results[anchor.cameraId] = resultFor(anchor, "high");
    context.results[firstView.cameraId] = resultFor(firstView, "empty");
    context.results[secondView.cameraId] = resultFor(secondView, "high");
    context.results[outer.cameraId] = resultFor(outer, "empty");

    const state = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual(
      definitions.map(({ cameraId }) => [cameraId])
    );
    expect(state?.terminals[anchor.terminalId]).toMatchObject({
      tailCameraId: secondView.cameraId,
      uncertain: false,
      coverage: "tail-search",
    });
  });

  // resolve the anchor's other view before choosing inward or outward search
  it("checks a clear paired anchor's queued counterpart before moving inward", async () => {
    const definitions = mukilteo;
    const [nearer, firstView, secondView, outer] = definitions;
    const initial = seededState(definitions, BASE, firstView.cameraId, {
      [nearer.cameraId]: "high",
      [firstView.cameraId]: "high",
    });
    const context = harness({ definitions, initial });
    context.results[firstView.cameraId] = resultFor(firstView, "empty");
    context.results[secondView.cameraId] = resultFor(secondView, "high");
    context.results[outer.cameraId] = resultFor(outer, "empty");

    const state = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual([
      [firstView.cameraId],
      [secondView.cameraId],
      [outer.cameraId],
    ]);
    expect(state?.terminals[firstView.terminalId]).toMatchObject({
      tailCameraId: secondView.cameraId,
      uncertain: false,
    });
  });

  // walk inward when the prior tail is now clear
  it("shrinks the prior queue tail toward the terminal", async () => {
    const definitions = clinton.slice(0, 4);
    const state = seededState(definitions, BASE, definitions[2].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "high",
      [definitions[2].cameraId]: "high",
      [definitions[3].cameraId]: "empty",
    });
    const context = harness({ definitions, initial: state });
    context.results[definitions[2].cameraId] = resultFor(
      definitions[2],
      "empty"
    );
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      "high"
    );

    const current = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual([
      [definitions[2].cameraId],
      [definitions[1].cameraId],
    ]);
    expect(current?.terminals[definitions[0].terminalId].tailCameraId).toBe(
      definitions[1].cameraId
    );
  });

  // treat a passing-only prior tail as clear and continue inward
  it("clears a queue when every remaining occupied camera is passing", async () => {
    const definitions = clinton.slice(0, 3);
    const state = seededState(definitions, BASE, definitions[1].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "high",
      [definitions[2].cameraId]: "empty",
    });
    const context = harness({ definitions, initial: state });
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      "high",
      true
    );
    context.results[definitions[0].cameraId] = resultFor(
      definitions[0],
      "low",
      true
    );

    const current = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual([
      [definitions[1].cameraId],
      [definitions[0].cameraId],
    ]);
    expect(current?.terminals[definitions[0].terminalId]).toMatchObject({
      tailCameraId: null,
      uncertain: false,
    });
  });

  // preserve the prior tail when visibility cannot establish an empty boundary
  it("keeps an unknown visible tail uncertain instead of reporting empty", async () => {
    const definitions = clinton.slice(0, 3);
    const state = seededState(definitions, BASE, definitions[1].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "high",
      [definitions[2].cameraId]: "empty",
    });
    const context = harness({ definitions, initial: state });
    context.results[definitions[1].cameraId] = resultFor(
      definitions[1],
      null,
      false,
      true
    );
    context.results[definitions[0].cameraId] = resultFor(
      definitions[0],
      "empty"
    );
    context.results[definitions[2].cameraId] = resultFor(
      definitions[2],
      "empty"
    );

    const current = await context.createPipeline().run();

    expect(submittedIds(context.classify)).toEqual([
      [definitions[1].cameraId],
      [definitions[0].cameraId],
      [definitions[2].cameraId],
    ]);
    expect(current?.terminals[definitions[0].terminalId]).toMatchObject({
      tailCameraId: definitions[1].cameraId,
      uncertain: true,
    });
  });

  // prevent stale source metadata and frozen tokens from reaching paid inference
  it("skips paid calls for stale and frozen camera feeds", async () => {
    const definitions = clinton.slice(0, 2);
    const state = seededState(definitions, BASE, definitions[0].cameraId, {
      [definitions[0].cameraId]: "high",
      [definitions[1].cameraId]: "empty",
    });
    state.cameras[definitions[0].cameraId].frameToken = "frozen-token";
    state.cameras[definitions[0].cameraId].frameUnchangedSince = BASE - SLOT;
    const context = harness({ definitions, initial: state });
    context.frameTokens[definitions[0].cameraId] = "frozen-token";
    context.frameUpdatedAts[definitions[1].cameraId] = BASE - SLOT;

    const current = await context.createPipeline().run();

    expect(context.classify).not.toHaveBeenCalled();
    expect(current?.terminals[definitions[0].terminalId]).toMatchObject({
      uncertain: true,
      tailCameraId: definitions[0].cameraId,
    });
    expect(current?.terminals[definitions[0].terminalId].errors).toEqual([
      `${definitions[0].cameraId}: Camera source is stale`,
      `${definitions[1].cameraId}: Camera source is stale`,
    ]);
  });

  // reject late inference output rather than spilling it into the next slot
  it("expires old-round output without publishing stale classifications", async () => {
    const definitions = clinton.slice(0, 1);
    const context = harness({ definitions });
    context.results[definitions[0].cameraId] = resultFor(
      definitions[0],
      "full"
    );
    context.classify.mockImplementationOnce(
      // cross the boundary while the paid request is in flight
      (images: OpenaiCameraPromptImage[]) => {
        context.setNow(BASE + SLOT);
        return Promise.resolve(
          images.map((image) => context.results[image.cameraId])
        );
      }
    );

    const expired = await context.createPipeline().run();

    expect(expired?.cameras[definitions[0].cameraId]).toMatchObject({
      result: null,
      error: "Camera round expired",
    });
    expect(expired?.terminals[definitions[0].terminalId]).toMatchObject({
      tailCameraId: null,
      uncertain: true,
    });

    const current = await context.createPipeline().run();
    expect(current?.cameras[definitions[0].cameraId].result).toEqual(
      context.results[definitions[0].cameraId]
    );
  });

  // reserve thirty seconds before the next tick for state finalization
  it("rejects inference completing at the four-minute-thirty-second cutoff", async () => {
    const definitions = clinton.slice(0, 1);
    const context = harness({ definitions });
    context.results[definitions[0].cameraId] = resultFor(
      definitions[0],
      "full"
    );
    context.classify.mockImplementationOnce(
      // land exactly on the exclusive round deadline
      (images: OpenaiCameraPromptImage[]) => {
        context.setNow(BASE + SLOT - 30_000);
        return Promise.resolve(
          images.map((image) => context.results[image.cameraId])
        );
      }
    );

    const expired = await context.createPipeline().run();

    expect(expired?.cameras[definitions[0].cameraId]).toMatchObject({
      result: null,
      error: "Camera round expired",
    });
    expect(expired?.terminals[definitions[0].terminalId]).toMatchObject({
      tailCameraId: null,
      uncertain: true,
    });
  });

  // persist a paid-attempt fence before calling the provider and never retry inline
  it("persists failed attempts before inference and does not retry", async () => {
    const definitions = clinton.slice(0, 2);
    const context = harness({ definitions });
    let persistedBeforeProvider = false;
    context.classify.mockImplementationOnce(
      // inspect the durable attempt marker at the provider boundary
      async () => {
        const persisted = await context.store.read();
        persistedBeforeProvider = definitions.every(
          ({ cameraId }) =>
            persisted.cameras[cameraId].lastSubmittedSlot === BASE
        );
        throw new Error("provider unavailable");
      }
    );

    const failed = await context.createPipeline().run();

    expect(persistedBeforeProvider).toBe(true);
    expect(context.classify).toHaveBeenCalledTimes(1);
    expect(failed?.terminals[definitions[0].terminalId].errors).toHaveLength(2);
    await expect(context.createPipeline().run()).resolves.toBeNull();
    expect(context.classify).toHaveBeenCalledTimes(1);
    expect(
      context.store.saves.some((saved) =>
        definitions.every(
          ({ cameraId }) =>
            saved.cameras[cameraId]?.lastSubmittedSlot === BASE &&
            saved.cameras[cameraId]?.error === "Classification pending"
        )
      )
    ).toBe(true);
  });

  // bound stable checks at five, ten, then fifteen minutes with full validation
  it("backs stable terminals off from five to ten to fifteen minutes", async () => {
    const definitions = clinton.slice(0, 2);
    const context = harness({ definitions });

    const first = await context.createPipeline().run();
    expect(first?.terminals[definitions[0].terminalId].nextCheckAt).toBe(
      BASE + SLOT
    );

    context.setNow(BASE + SLOT);
    const second = await context.createPipeline().run();
    expect(second?.terminals[definitions[0].terminalId]).toMatchObject({
      nextCheckAt: BASE + 3 * SLOT,
      stableRounds: 1,
    });

    context.prepare.mockClear();
    context.setNow(BASE + 2 * SLOT);
    await context.createPipeline().run();
    expect(context.prepare).not.toHaveBeenCalled();

    context.setNow(BASE + 3 * SLOT);
    const third = await context.createPipeline().run();
    expect(context.prepare).toHaveBeenCalledTimes(definitions.length);
    expect(third?.terminals[definitions[0].terminalId]).toMatchObject({
      coverage: "full",
      lastFullScanAt: BASE + 3 * SLOT,
      nextCheckAt: BASE + 6 * SLOT,
      stableRounds: 2,
    });
  });

  // exclude cancelled and passenger-only sailings from mandatory scan overrides
  it("ignores cancelled and passenger-only departures", async () => {
    const definitions = clinton.slice(0, 2);
    const context = harness({ definitions });
    await context.createPipeline().run();
    context.setNow(BASE + SLOT);
    await context.createPipeline().run();
    context.prepare.mockClear();
    context.setNow(BASE + 2 * SLOT);
    context.setDepartures([
      departure(definitions[0].terminalId, BASE + 2 * SLOT + 3 * 60_000, {
        isCancelled: true,
      }),
      departure(definitions[0].terminalId, BASE + 2 * SLOT + 4 * 60_000, {
        allowsVehicles: false,
      }),
    ]);

    await context.createPipeline().run();

    expect(context.prepare).not.toHaveBeenCalled();
    expect(context.classify).toHaveBeenCalledTimes(1);
  });
});
