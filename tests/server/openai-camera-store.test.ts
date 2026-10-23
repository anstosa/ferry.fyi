import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OpenaiCameraObservation,
  OpenaiCameraPipelineState,
} from "../../server/lib/openaiCameraTypes";

const rows = vi.hoisted(() => new Map<string, ReturnType<typeof makeRow>>());
const transaction = vi.hoisted(() => ({ LOCK: { UPDATE: "UPDATE" } }));
const model = vi.hoisted(() => ({
  sequelize: {
    // execute one mocked atomic transaction
    transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction))
    ),
  },
  findByPk: vi.fn(),
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
}));

vi.mock("~/models/OpenaiCameraPipelineState", () => ({
  OpenaiCameraPipelineState: model,
}));

import {
  createEmptyOpenaiCameraState,
  DatabaseOpenaiCameraStore,
} from "../../server/lib/openaiCameraStore";

// build one detached persisted row
function makeRow(initialState: OpenaiCameraPipelineState) {
  const row = {
    state: structuredClone(initialState),
    // emulate jsonb replacement semantics
    update: vi.fn(({ state }: { state: OpenaiCameraPipelineState }) => {
      row.state = structuredClone(state);
      return Promise.resolve(row);
    }),
  };
  return row;
}

// build one complete derived observation
const observation = (slot: number): OpenaiCameraObservation => ({
  cameraId: "clinton-terminal",
  checkedAt: slot,
  inferredAt: slot,
  frameUpdatedAt: slot - 1,
  frameUnchangedSince: slot - 1,
  frameToken: "derived-frame-token",
  fingerprint: "derived-fingerprint",
  inferenceKey: "derived-inference-key",
  lastSubmittedSlot: slot,
  result: {
    cameraId: "clinton-terminal",
    visibilityProblems: false,
    lanes: [
      {
        cameraId: "clinton-terminal",
        laneId: "lane-1-front",
        skippedDueToVisibility: false,
        occupancyState: "high",
        passing: false,
      },
    ],
  },
  lanes: [
    {
      cameraId: "clinton-terminal",
      laneId: "lane-1",
      occupancyState: "high",
      sectionIds: ["lane-1-front"],
      skippedDueToVisibility: false,
    },
  ],
  error: null,
  freshness: "fresh",
  reused: false,
});

describe("database openai camera store", () => {
  // reset the isolated singleton row
  beforeEach(() => {
    rows.clear();
    vi.clearAllMocks();
    model.findByPk.mockImplementation((key: string) =>
      Promise.resolve(rows.get(key) ?? null)
    );
    model.findOrCreate.mockImplementation(
      ({
        defaults,
        where,
      }: {
        defaults: { state: OpenaiCameraPipelineState };
        where: { key: string };
      }) => {
        // create the first singleton row once
        if (!rows.has(where.key)) {
          rows.set(where.key, makeRow(defaults.state));
        }
        return Promise.resolve([rows.get(where.key), false]);
      }
    );
    model.findOne.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(rows.get(where.key))
    );
  });

  // prove first-use creation and durable detached reads
  it("claims, saves, and reads a detached durable snapshot", async () => {
    const store = new DatabaseOpenaiCameraStore(model);
    const claimed = await store.beginRound(300);
    expect(claimed).not.toBeNull();
    claimed!.lastCompletedAt = 301;
    claimed!.cameras["clinton-terminal"] = observation(300);
    claimed!.terminals.clinton = {
      lastCheckedAt: 300,
      lastFullScanAt: 300,
      nextCheckAt: 600,
      tailCameraId: "clinton-terminal",
      stableRounds: 1,
      uncertain: false,
      coverage: "full",
      coveredCameraIds: ["clinton-terminal"],
      errors: [],
    };

    await store.save(claimed!);
    const firstRead = await store.read();
    firstRead.cameras["clinton-terminal"].fingerprint = "mutated-reader";
    const secondRead = await store.read();

    expect(secondRead.lastStartedSlot).toBe(300);
    expect(secondRead.lastCompletedAt).toBe(301);
    expect(secondRead.cameras["clinton-terminal"].fingerprint).toBe(
      "derived-fingerprint"
    );
    expect(model.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: "UPDATE", transaction })
    );
  });

  // prove slot claims remain strictly monotonic
  it("rejects duplicate and older slots after persisting the claim", async () => {
    const store = new DatabaseOpenaiCameraStore(model);

    await expect(store.beginRound(300)).resolves.toMatchObject({
      lastStartedSlot: 300,
    });
    await expect(store.beginRound(300)).resolves.toBeNull();
    await expect(store.beginRound(299)).resolves.toBeNull();
    await expect(store.beginRound(600)).resolves.toMatchObject({
      lastStartedSlot: 600,
    });

    expect((await store.read()).lastStartedSlot).toBe(600);
  });

  // prove a stale owner cannot overwrite a newer claim
  it("fences an older round save", async () => {
    const store = new DatabaseOpenaiCameraStore(model);
    const oldOwner = await store.beginRound(300);
    await store.beginRound(600);
    oldOwner!.lastCompletedAt = 999;

    await expect(store.save(oldOwner!)).rejects.toThrow("newer round owns");

    const persisted = await store.read();
    expect(persisted.lastStartedSlot).toBe(600);
    expect(persisted.lastCompletedAt).toBeNull();
  });

  // prove raw imagery and credentials never reach jsonb
  it("rejects raw image or credential fields", async () => {
    const store = new DatabaseOpenaiCameraStore(model);
    const claimed = await store.beginRound(300);
    const unsafeCredential = structuredClone(claimed) as
      (OpenaiCameraPipelineState & { apiKey: string }) | null;
    unsafeCredential!.apiKey = "test-secret";
    const unsafeImage = structuredClone(claimed)!;
    unsafeImage.cameras.unsafe = {
      imageBase64: "raw-image",
    } as never;

    await expect(store.save(unsafeCredential!)).rejects.toThrow(
      "unknown field apiKey"
    );
    await expect(store.save(unsafeImage)).rejects.toThrow(
      "prohibited field state.cameras.unsafe.imageBase64"
    );
    expect(rows.get("default")?.state).toEqual({
      ...createEmptyOpenaiCameraState(),
      lastStartedSlot: 300,
    });
  });

  // prove malformed claims fail before opening a transaction
  it("rejects malformed round slots", async () => {
    const store = new DatabaseOpenaiCameraStore(model);

    await expect(store.beginRound(Number.NaN)).rejects.toThrow(
      "non-negative integer"
    );
    await expect(store.beginRound(-1)).rejects.toThrow("non-negative integer");
    expect(model.sequelize.transaction).not.toHaveBeenCalled();
  });
});
