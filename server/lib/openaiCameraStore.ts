import type { OpenaiCameraPipelineState as OpenaiCameraPipelineStateValue } from "~/lib/openaiCameraTypes";
import { OpenaiCameraPipelineState as OpenaiCameraPipelineStateModel } from "~/models/OpenaiCameraPipelineState";

const OPENAI_CAMERA_STATE_KEY = "default";
const OPENAI_CAMERA_STATE_FIELDS = new Set([
  "cameras",
  "lastCompletedAt",
  "lastStartedSlot",
  "terminals",
  "version",
]);
const PROHIBITED_STATE_FIELDS = new Set([
  "apiKey",
  "authorization",
  "image",
  "imageBase64",
  "imageBytes",
  "imageData",
  "password",
  "raw",
  "rawBytes",
  "rawFrame",
  "rawImage",
  "secret",
]);

interface OpenaiCameraStoreTransaction {
  LOCK: { UPDATE: unknown };
}

interface OpenaiCameraStoreRow {
  state: OpenaiCameraPipelineStateValue;
  update(
    values: { state: OpenaiCameraPipelineStateValue },
    options: { transaction: OpenaiCameraStoreTransaction }
  ): Promise<unknown>;
}

interface OpenaiCameraStoreModel {
  sequelize?: {
    transaction<T>(
      callback: (transaction: OpenaiCameraStoreTransaction) => Promise<T>
    ): Promise<T>;
  };
  findByPk(key: string): Promise<OpenaiCameraStoreRow | null>;
  findOne(options: {
    lock: unknown;
    transaction: OpenaiCameraStoreTransaction;
    where: { key: string };
  }): Promise<OpenaiCameraStoreRow | null>;
  findOrCreate(options: {
    defaults: {
      key: string;
      state: OpenaiCameraPipelineStateValue;
    };
    transaction: OpenaiCameraStoreTransaction;
    where: { key: string };
  }): Promise<[OpenaiCameraStoreRow, boolean]>;
}

const DEFAULT_OPENAI_CAMERA_STORE_MODEL =
  OpenaiCameraPipelineStateModel as unknown as OpenaiCameraStoreModel;

export interface OpenaiCameraStore {
  read(): Promise<OpenaiCameraPipelineStateValue>;
  beginRound(slot: number): Promise<OpenaiCameraPipelineStateValue | null>;
  save(state: OpenaiCameraPipelineStateValue): Promise<void>;
}

// create one detached empty scheduler snapshot
export const createEmptyOpenaiCameraState =
  (): OpenaiCameraPipelineStateValue => ({
    version: 1,
    lastStartedSlot: null,
    lastCompletedAt: null,
    cameras: {},
    terminals: {},
  });

// recognize json object containers
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

// reject data that cannot enter bounded json state
const assertJsonStateValue = (
  value: unknown,
  path: string,
  ancestors: Set<object>
): void => {
  // accept json primitives
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  // reject lossy json numbers
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `OpenAI camera state contains a non-finite number at ${path}`
      );
    }
    return;
  }
  // reject non-json values and binary payloads
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    throw new Error(`OpenAI camera state contains non-JSON data at ${path}`);
  }
  // reject cycles before serialization
  if (ancestors.has(value)) {
    throw new Error(`OpenAI camera state contains a cycle at ${path}`);
  }
  ancestors.add(value);
  // inspect array entries
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertJsonStateValue(entry, `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  // reject class instances such as buffers and dates
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`OpenAI camera state contains non-JSON data at ${path}`);
  }
  // inspect every nested property
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_STATE_FIELDS.has(key)) {
      throw new Error(
        `OpenAI camera state contains prohibited field ${path}.${key}`
      );
    }
    assertJsonStateValue(entry, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
};

// validate scheduler fields before persistence
const assertPipelineState = (state: OpenaiCameraPipelineStateValue): void => {
  // require the current state schema
  if (!isRecord(state) || state.version !== 1) {
    throw new Error("OpenAI camera state has an unsupported version");
  }
  // reject unbounded root data
  for (const key of Object.keys(state)) {
    if (!OPENAI_CAMERA_STATE_FIELDS.has(key)) {
      throw new Error(`OpenAI camera state contains unknown field ${key}`);
    }
  }
  // require valid round fencing
  if (
    state.lastStartedSlot !== null &&
    (!Number.isSafeInteger(state.lastStartedSlot) || state.lastStartedSlot < 0)
  ) {
    throw new Error("OpenAI camera state has an invalid last started slot");
  }
  // require valid completion chronology
  if (
    state.lastCompletedAt !== null &&
    (!Number.isSafeInteger(state.lastCompletedAt) || state.lastCompletedAt < 0)
  ) {
    throw new Error("OpenAI camera state has an invalid completion time");
  }
  // require both state maps
  if (!isRecord(state.cameras) || !isRecord(state.terminals)) {
    throw new Error("OpenAI camera state maps are invalid");
  }
  assertJsonStateValue(state, "state", new Set());
};

// clone state across every store boundary
const cloneState = (
  state: OpenaiCameraPipelineStateValue
): OpenaiCameraPipelineStateValue => {
  assertPipelineState(state);
  return JSON.parse(JSON.stringify(state)) as OpenaiCameraPipelineStateValue;
};

// persist one fenced scheduler snapshot
export class DatabaseOpenaiCameraStore implements OpenaiCameraStore {
  private readonly model: OpenaiCameraStoreModel;

  // bind the store to its sequelize model
  constructor(
    model: OpenaiCameraStoreModel = DEFAULT_OPENAI_CAMERA_STORE_MODEL
  ) {
    // require transaction support for claims and saves
    if (!model.sequelize) {
      throw new Error("OpenAI camera state store is unavailable");
    }
    this.model = model;
  }

  // return a detached state snapshot
  async read(): Promise<OpenaiCameraPipelineStateValue> {
    const row = await this.model.findByPk(OPENAI_CAMERA_STATE_KEY);
    return row ? cloneState(row.state) : createEmptyOpenaiCameraState();
  }

  // claim a newer slot before provider work
  beginRound(slot: number): Promise<OpenaiCameraPipelineStateValue | null> {
    // reject malformed slot claims
    if (!Number.isSafeInteger(slot) || slot < 0) {
      return Promise.reject(
        new Error("OpenAI camera round slot must be a non-negative integer")
      );
    }
    return this.model.sequelize!.transaction(async (transaction) => {
      const row = await this.getLockedRow(transaction);
      const current = cloneState(row.state);
      // reject duplicate and stale rounds
      if (current.lastStartedSlot !== null && slot <= current.lastStartedSlot) {
        return null;
      }
      const claimed = cloneState({ ...current, lastStartedSlot: slot });
      await row.update({ state: claimed }, { transaction });
      return cloneState(claimed);
    });
  }

  // save only the currently claimed slot
  async save(state: OpenaiCameraPipelineStateValue): Promise<void> {
    const detached = cloneState(state);
    await this.model.sequelize!.transaction(async (transaction) => {
      const row = await this.getLockedRow(transaction);
      const current = cloneState(row.state);
      // fence stale round owners
      if (current.lastStartedSlot !== detached.lastStartedSlot) {
        throw new Error(
          "OpenAI camera state save rejected because a newer round owns the state"
        );
      }
      await row.update({ state: detached }, { transaction });
    });
  }

  // create then lock the singleton row
  private async getLockedRow(
    transaction: OpenaiCameraStoreTransaction
  ): Promise<OpenaiCameraStoreRow> {
    await this.model.findOrCreate({
      defaults: {
        key: OPENAI_CAMERA_STATE_KEY,
        state: createEmptyOpenaiCameraState(),
      },
      transaction,
      where: { key: OPENAI_CAMERA_STATE_KEY },
    });
    const row = await this.model.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { key: OPENAI_CAMERA_STATE_KEY },
    });
    // require the first-use insertion result
    if (!row) {
      throw new Error("OpenAI camera state row was not created");
    }
    return row;
  }
}

export const databaseOpenaiCameraStore = new DatabaseOpenaiCameraStore();
