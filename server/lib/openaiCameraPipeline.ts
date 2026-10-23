import type { OpenaiCameraPreparedFrame } from "./openaiCameraImages";
import {
  aggregateOpenaiCameraLanes,
  getOpenaiCameraQueueEvidence,
  getOpenaiCameraSlot,
  getOpenaiPredepartureSlot,
  OPENAI_CAMERA_SLOT_MS,
  OPENAI_CAMERA_VALIDATION_MS,
} from "./openaiCameraPlanning";
import type { OpenaiCameraStore } from "./openaiCameraStore";
import type {
  OpenaiCameraDefinition,
  OpenaiCameraImageResult,
  OpenaiCameraObservation,
  OpenaiCameraPipelineState,
  OpenaiCameraPromptImage,
} from "./openaiCameraTypes";

export interface OpenaiCameraDeparture {
  terminalId: string;
  predictedDepartureAt: number;
  allowsVehicles: boolean;
  isCancelled: boolean;
}

export interface OpenaiCameraPipelineOptions {
  definitions: OpenaiCameraDefinition[];
  store: OpenaiCameraStore;
  inferenceKey: string;
  prepare: (
    definition: OpenaiCameraDefinition,
    signal: AbortSignal
  ) => Promise<OpenaiCameraPreparedFrame>;
  classify: (
    images: OpenaiCameraPromptImage[],
    signal: AbortSignal
  ) => Promise<OpenaiCameraImageResult[]>;
  getDepartures: () => OpenaiCameraDeparture[];
  getNow?: () => number;
}

interface TerminalPlan {
  terminalId: string;
  definitions: OpenaiCameraDefinition[];
  full: boolean;
  anchor: OpenaiCameraDefinition;
  previousSignature: string;
}

interface PendingCamera {
  definition: OpenaiCameraDefinition;
  frame: OpenaiCameraPreparedFrame;
}

// share one fenced round across ordered processing phases
interface CameraRound {
  state: OpenaiCameraPipelineState;
  slot: number;
  deadline: number;
  signal: AbortSignal;
  visited: Set<string>;
}

// represent a missing result without inventing an empty lane
const emptyObservation = (cameraId: string): OpenaiCameraObservation => ({
  cameraId,
  checkedAt: 0,
  inferredAt: null,
  frameUpdatedAt: null,
  frameUnchangedSince: 0,
  frameToken: "",
  fingerprint: null,
  inferenceKey: null,
  lastSubmittedSlot: null,
  result: null,
  lanes: [],
  error: "No classification available",
  freshness: "unknown",
  reused: false,
});

// commit one uniquely keyed preprocessing result synchronously
const setObservation = (
  state: OpenaiCameraPipelineState,
  observation: OpenaiCameraObservation
): void => {
  state.cameras[observation.cameraId] = observation;
};

// compare derived evidence rather than volatile check timestamps
const terminalSignature = (
  state: OpenaiCameraPipelineState,
  definitions: OpenaiCameraDefinition[]
): string =>
  JSON.stringify(
    definitions.map(({ cameraId }) => {
      const observation = state.cameras[cameraId];
      return [
        cameraId,
        observation?.result ?? null,
        observation?.error ?? null,
        observation?.freshness === "stale",
      ];
    })
  );

// orchestrate a new pipeline without reading or mutating YOLO results
export class OpenaiCameraPipeline {
  private readonly options: OpenaiCameraPipelineOptions;
  private readonly now: () => number;
  private inProgress: Promise<OpenaiCameraPipelineState | null> | null = null;

  // keep every external effect injectable for offline regression tests
  constructor(options: OpenaiCameraPipelineOptions) {
    const cameraIds = options.definitions.map(({ cameraId }) => cameraId);
    // unique keys make concurrent preprocessing updates independent
    if (new Set(cameraIds).size !== cameraIds.length) {
      throw new Error("OpenAI camera definitions contain duplicate camera IDs");
    }
    this.options = options;
    this.now = options.getNow ?? Date.now;
  }

  // collapse concurrent local invocations while the database fences restarts
  run(): Promise<OpenaiCameraPipelineState | null> {
    // share an existing invocation instead of starting competing prompts
    if (this.inProgress) {
      return this.inProgress;
    }
    this.inProgress = this.runRound().finally(() => {
      this.inProgress = null;
    });
    return this.inProgress;
  }

  // plan due terminals from current predictions and bounded stable backoff
  private plans(
    state: OpenaiCameraPipelineState,
    slot: number
  ): TerminalPlan[] {
    const terminals = new Map<string, OpenaiCameraDefinition[]>();
    // preserve terminal-local camera distance order
    for (const definition of this.options.definitions) {
      const cameras = terminals.get(definition.terminalId) ?? [];
      cameras.push(definition);
      terminals.set(definition.terminalId, cameras);
    }
    const departures = this.options.getDepartures();
    const plans: TerminalPlan[] = [];
    // coalesce every full scan and anchor into one initial prompt
    for (const [terminalId, cameras] of terminals) {
      cameras.sort((left, right) => left.order - right.order);
      const previous = state.terminals[terminalId];
      const activeDepartures = departures.filter(
        (departure) =>
          departure.terminalId === terminalId &&
          departure.allowsVehicles &&
          !departure.isCancelled &&
          Number.isFinite(departure.predictedDepartureAt)
      );
      const serviceActive = activeDepartures.some(
        (departure) =>
          departure.predictedDepartureAt >=
            slot - OPENAI_CAMERA_VALIDATION_MS &&
          departure.predictedDepartureAt <= slot + 60 * 60_000
      );
      // avoid overnight and no-service inference while retaining delayed carry-over sailings
      if (!serviceActive) {
        continue;
      }
      // share eligibility between service windows and mandatory departure scans
      const beforeDeparture = activeDepartures.some(
        (departure) =>
          getOpenaiPredepartureSlot(departure.predictedDepartureAt) === slot
      );
      const invalidated = cameras.some(
        ({ cameraId }) =>
          state.cameras[cameraId]?.inferenceKey !== this.options.inferenceKey
      );
      const full =
        !previous?.lastFullScanAt ||
        invalidated ||
        beforeDeparture ||
        slot - previous.lastFullScanAt >= OPENAI_CAMERA_VALIDATION_MS;
      // never let backoff suppress a required full scan
      if (!full && previous.nextCheckAt > slot) {
        continue;
      }
      const anchor =
        cameras.find(({ cameraId }) => cameraId === previous?.tailCameraId) ??
        cameras[0];
      plans.push({
        terminalId,
        definitions: cameras,
        full,
        anchor,
        previousSignature: terminalSignature(state, cameras),
      });
    }
    return plans;
  }

  // reject stale or failed observations as reliable search boundaries
  private evidence(
    state: OpenaiCameraPipelineState,
    cameraId: string
  ): "queued" | "clear" | "unknown" {
    const observation = state.cameras[cameraId];
    // cached failures must not shorten a reported queue
    if (
      !observation ||
      observation.error ||
      observation.freshness !== "fresh" ||
      this.now() - observation.checkedAt > OPENAI_CAMERA_VALIDATION_MS
    ) {
      return "unknown";
    }
    return getOpenaiCameraQueueEvidence(observation.result);
  }

  // fetch once per round and avoid paid analysis for unchanged lane pixels
  private async prepareCamera(
    state: OpenaiCameraPipelineState,
    definition: OpenaiCameraDefinition,
    signal: AbortSignal
  ): Promise<PendingCamera | null> {
    const previous =
      state.cameras[definition.cameraId] ??
      emptyObservation(definition.cameraId);
    try {
      const frame = await this.options.prepare(definition, signal);
      const checkedAt = this.now();
      const frameUnchangedSince =
        frame.frameToken === previous.frameToken
          ? previous.frameUnchangedSince
          : checkedAt;
      const stale =
        (frame.frameUpdatedAt !== null &&
          checkedAt - frame.frameUpdatedAt >= OPENAI_CAMERA_SLOT_MS) ||
        checkedAt - frameUnchangedSince >= OPENAI_CAMERA_SLOT_MS;
      const observation: OpenaiCameraObservation = {
        ...previous,
        checkedAt,
        frameUpdatedAt: frame.frameUpdatedAt,
        frameToken: frame.frameToken,
        frameUnchangedSince,
        freshness: "unknown",
        reused: false,
        error: stale ? "Camera source is stale" : "Classification pending",
      };
      setObservation(state, observation);
      // a frozen feed is not a newly observed empty queue
      if (stale) {
        observation.freshness = "stale";
        return null;
      }
      // keep unknown source timestamps distinct from confirmed freshness
      if (
        frame.frameUpdatedAt !== null &&
        frame.frameUpdatedAt <= checkedAt + 60_000
      ) {
        observation.freshness = "fresh";
      }
      // a recent observed source advance can establish freshness without a timestamp
      if (
        frame.frameUpdatedAt === null &&
        previous.frameToken &&
        frame.frameToken !== previous.frameToken &&
        checkedAt - previous.checkedAt <= OPENAI_CAMERA_VALIDATION_MS
      ) {
        observation.freshness = "fresh";
      }
      // fingerprints include source geometry and countable masks but not annotation ink
      if (
        previous.result &&
        previous.fingerprint === frame.image.fingerprint &&
        previous.inferenceKey === this.options.inferenceKey
      ) {
        observation.error = null;
        observation.reused = true;
        return null;
      }
      return { definition, frame };
    } catch {
      // preserve the previous inference and its age without fabricating a result
      setObservation(state, {
        ...previous,
        checkedAt: this.now(),
        reused: false,
        error: signal.aborted
          ? "Camera round expired"
          : "Camera image preparation failed",
      });
      return null;
    }
  }

  // fence every prompt against its actual submission slot
  private isRoundActive(round: CameraRound): boolean {
    return (
      !round.signal.aborted &&
      this.now() < round.deadline &&
      getOpenaiCameraSlot(this.now()) === round.slot
    );
  }

  // preprocess concurrently but never issue concurrent model prompts
  private async processBatch(
    round: CameraRound,
    definitions: OpenaiCameraDefinition[]
  ): Promise<void> {
    const { state, slot, signal, visited } = round;
    // abandon old work instead of submitting it into a newer slot
    if (!this.isRoundActive(round)) {
      return;
    }
    const selected = definitions.filter(
      ({ cameraId }) =>
        !visited.has(cameraId) &&
        state.cameras[cameraId]?.lastSubmittedSlot !== slot
    );
    // reserve local fetch identities even when a cached result is reused
    for (const { cameraId } of selected) {
      visited.add(cameraId);
    }
    const prepared = await Promise.all(
      selected.map((definition) =>
        this.prepareCamera(state, definition, signal)
      )
    );
    const pending = prepared.filter(
      (value): value is PendingCamera => value !== null
    );
    // record checks and reuse even when no paid prompt is needed
    if (!pending.length || !this.isRoundActive(round)) {
      await this.options.store.save(state);
      return;
    }
    // commit attempts before spending so crashes and invalid responses cannot replay them
    for (const { definition } of pending) {
      state.cameras[definition.cameraId].lastSubmittedSlot = slot;
    }
    await this.options.store.save(state);
    // a storage wait may cross the boundary
    if (!this.isRoundActive(round)) {
      return;
    }
    try {
      const results = await this.options.classify(
        pending.map(({ frame }) => frame.image),
        signal
      );
      // a late response must not refresh evidence in a newer clock slot
      if (!this.isRoundActive(round)) {
        throw new Error("Camera round expired");
      }
      const byId = new Map(results.map((result) => [result.cameraId, result]));
      // enforce exact batch cardinality even for injected providers
      if (
        byId.size !== pending.length ||
        results.length !== pending.length ||
        pending.some(({ definition }) => !byId.has(definition.cameraId))
      ) {
        throw new Error("Camera response identities do not match the batch");
      }
      // apply one coherent validated batch
      for (const { definition, frame } of pending) {
        const result = byId.get(definition.cameraId)!;
        Object.assign(state.cameras[definition.cameraId], {
          fingerprint: frame.image.fingerprint,
          inferenceKey: this.options.inferenceKey,
          inferredAt: this.now(),
          result,
          lanes: aggregateOpenaiCameraLanes(definition, result),
          error: null,
        });
      }
    } catch {
      // do not retry ambiguous requests or falsely report old evidence as current
      for (const { definition } of pending) {
        state.cameras[definition.cameraId].error = this.isRoundActive(round)
          ? "OpenAI camera classification failed"
          : "Camera round expired";
      }
    }
    await this.options.store.save(state);
  }

  // combine paired views without treating unknown visibility as an empty boundary
  private markerEvidence(
    state: OpenaiCameraPipelineState,
    definitions: OpenaiCameraDefinition[]
  ): "queued" | "clear" | "unknown" {
    const evidence = definitions.map(({ cameraId }) =>
      this.evidence(state, cameraId)
    );
    // any stopped queue remains positive evidence across paired views
    if (evidence.includes("queued")) {
      return "queued";
    }
    // every view must be visible before the marker can bound an empty queue
    if (evidence.includes("unknown")) {
      return "unknown";
    }
    return "clear";
  }

  // walk physical markers serially from the prior queue tail
  private async searchTerminal(
    round: CameraRound,
    plan: TerminalPlan
  ): Promise<void> {
    const { state, visited } = round;
    // full scans already cover the complete configured range
    if (plan.full || !this.isRoundActive(round)) {
      return;
    }
    const markers = [
      ...new Set(plan.definitions.map(({ markerId }) => markerId)),
    ];
    const anchorCameras = plan.definitions.filter(
      ({ markerId }) => markerId === plan.anchor.markerId
    );
    // resolve the anchor's remaining views before choosing a search direction
    for (const definition of anchorCameras.filter(
      ({ cameraId }) => !visited.has(cameraId)
    )) {
      await this.processBatch(round, [definition]);
    }
    const anchorEvidence = this.markerEvidence(state, anchorCameras);
    // unknown anchors require complete coverage rather than an assumed empty boundary
    if (anchorEvidence === "unknown") {
      // unknown visibility cannot hide a farther queued camera
      for (const definition of plan.definitions) {
        await this.processBatch(round, [definition]);
      }
      return;
    }
    const direction = anchorEvidence === "clear" ? -1 : 1;
    // finish every view of a marker before accepting its search boundary
    for (
      let cursor = markers.indexOf(plan.anchor.markerId) + direction;
      cursor >= 0 && cursor < markers.length && this.isRoundActive(round);
      cursor += direction
    ) {
      const cameras = plan.definitions.filter(
        ({ markerId }) => markerId === markers[cursor]
      );
      // follow-up prompts retain one image each even for paired views
      for (const definition of cameras) {
        await this.processBatch(round, [definition]);
      }
      const evidence = this.markerEvidence(state, cameras);
      // only confirmed evidence establishes the new end of the line
      if (
        (direction === 1 && evidence === "clear") ||
        (direction === -1 && evidence === "queued")
      ) {
        break;
      }
    }
  }

  // derive coverage and bounded backoff without extending the round
  private finalizeTerminal(round: CameraRound, plan: TerminalPlan): void {
    const { state, slot, visited } = round;
    const covered = plan.definitions.filter(({ cameraId }) =>
      visited.has(cameraId)
    );
    const unknown =
      !covered.length ||
      covered.some(
        ({ cameraId }) => this.evidence(state, cameraId) === "unknown"
      );
    const queued = covered.filter(
      ({ cameraId }) => this.evidence(state, cameraId) === "queued"
    );
    const tail = queued[queued.length - 1]?.cameraId ?? null;
    const previous = state.terminals[plan.terminalId];
    const stable =
      !unknown &&
      previous &&
      plan.previousSignature === terminalSignature(state, plan.definitions);
    const stableRounds = stable ? previous.stableRounds + 1 : 0;
    const interval = unknown
      ? OPENAI_CAMERA_SLOT_MS
      : Math.min(
          OPENAI_CAMERA_VALIDATION_MS,
          (stableRounds + 1) * OPENAI_CAMERA_SLOT_MS
        );
    const complete =
      covered.length === plan.definitions.length &&
      covered.every(
        ({ cameraId }) =>
          !state.cameras[cameraId].error &&
          state.cameras[cameraId].freshness === "fresh"
      );
    state.terminals[plan.terminalId] = {
      lastCheckedAt: this.now(),
      lastFullScanAt:
        plan.full && complete ? slot : (previous?.lastFullScanAt ?? null),
      nextCheckAt: slot + interval,
      tailCameraId:
        unknown && tail === null ? (previous?.tailCameraId ?? null) : tail,
      stableRounds,
      uncertain: unknown || !this.isRoundActive(round),
      coverage: plan.full ? "full" : "tail-search",
      coveredCameraIds: covered.map(({ cameraId }) => cameraId),
      errors: covered.flatMap(({ cameraId }) =>
        state.cameras[cameraId].error
          ? [`${cameraId}: ${state.cameras[cameraId].error}`]
          : []
      ),
    };
  }

  // run one grouped boundary prompt followed only by serial search prompts
  private async runRound(): Promise<OpenaiCameraPipelineState | null> {
    const slot = getOpenaiCameraSlot(this.now());
    // manual invocations cannot create an off-tick initial prompt
    if (this.now() - slot > 30_000) {
      return null;
    }
    const state = await this.options.store.beginRound(slot);
    // persistently claimed slots cannot be replayed after a restart
    if (!state) {
      return null;
    }
    const deadline = slot + OPENAI_CAMERA_SLOT_MS - 30_000;
    const signal = AbortSignal.timeout(Math.max(1, deadline - this.now()));
    const plans = this.plans(state, slot);
    const round: CameraRound = {
      state,
      slot,
      deadline,
      signal,
      visited: new Set(),
    };

    await this.processBatch(
      round,
      plans.flatMap((plan) => (plan.full ? plan.definitions : [plan.anchor]))
    );
    // search one terminal at a time with at most one additional image per prompt
    for (const plan of plans) {
      await this.searchTerminal(round, plan);
      this.finalizeTerminal(round, plan);
    }
    Object.assign(state, { lastCompletedAt: this.now() });
    await this.options.store.save(state);
    return state;
  }
}
