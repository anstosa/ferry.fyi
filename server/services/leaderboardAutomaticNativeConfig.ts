import { createHash } from "node:crypto";

import { Op, type Transaction } from "sequelize";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  type AutomaticTerminalRegionV1,
} from "shared/contracts/leaderboards";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";
import { canonicalAutomaticTerminalRegionBytesV1 } from "shared/lib/leaderboardAutomaticContracts";

import { db } from "~/lib/db";
import { LeaderboardAutomaticTerminalConfig } from "~/models/LeaderboardAutomaticTerminalConfig";
import { Terminal } from "~/models/Terminal";

export const AUTOMATIC_TERMINAL_CONFIG_SCHEMA_VERSION =
  AUTOMATIC_CHECKIN_SCHEMA_VERSION;
export const AUTOMATIC_TERMINAL_CANDIDATE_RETENTION_MS =
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS;
export const AUTOMATIC_TERMINAL_RADIUS_MILLIMETERS = 304_800;
export const ANDROID_AUTOMATIC_TERMINAL_REGION_BUDGET = 100;
export const IOS_AUTOMATIC_TERMINAL_REGION_BUDGET = 20;

/** fixed configuration readiness failures */
export type AutomaticTerminalConfigErrorCode =
  | "duplicate_terminal"
  | "empty_terminal_set"
  | "generation_exhausted"
  | "hash_mismatch"
  | "invalid_coordinate"
  | "invalid_generation"
  | "invalid_policy"
  | "invalid_radius"
  | "incomplete_terminal_set"
  | "missing_durable_config"
  | "noncanonical_region_json"
  | "over_platform_budget"
  | "sparse_terminal"
  | "stale_schema";

/** fixed fail-closed configuration error */
export class AutomaticTerminalConfigError extends Error {
  code: AutomaticTerminalConfigErrorCode;

  // keep public failures data-free
  constructor(code: AutomaticTerminalConfigErrorCode) {
    super(code);
    this.code = code;
    this.name = "AutomaticTerminalConfigError";
  }
}

/** platform-owned region limits */
export interface AutomaticTerminalPlatformBudgets {
  androidRegionBudget: number;
  iosRegionBudget: number;
}

/** immutable generation policy inputs */
interface AutomaticTerminalConfigGenerationPolicy {
  candidateRetentionMs?: number;
  futureToleranceMs: number;
  now?: Date;
  radiusMillimeters?: number;
  transportRetentionMs: number;
}

/** complete generation inputs */
export type AutomaticTerminalConfigGenerationOptions =
  AutomaticTerminalPlatformBudgets & AutomaticTerminalConfigGenerationPolicy;

/** validated durable generation */
export interface LoadedAutomaticTerminalConfig {
  activatedAt: Date;
  configGeneration: number;
  contentHash: string;
  generatedAt: Date;
  regionJson: string;
  regions: AutomaticTerminalRegionV1[];
  retainUntil: Date;
  schemaVersion: typeof AUTOMATIC_TERMINAL_CONFIG_SCHEMA_VERSION;
}

/** generation-independent stored geometry */
interface StoredAutomaticTerminalRegionV1 {
  latitudeE7: number;
  longitudeE7: number;
  radiusMillimeters: number;
  terminalId: string;
}

/** persistence row shape */
interface StoredConfigRow {
  activatedAt: Date;
  configGeneration: number | string;
  contentHash: string;
  generatedAt: Date;
  regionJson: string;
  retainUntil: Date;
  schemaVersion: number;
}

const defaultPlatformBudgets: AutomaticTerminalPlatformBudgets = {
  androidRegionBudget: ANDROID_AUTOMATIC_TERMINAL_REGION_BUDGET,
  iosRegionBudget: IOS_AUTOMATIC_TERMINAL_REGION_BUDGET,
};

// use static data only for the canonical active identifier set
const expectedTerminalIds = new Set(Object.keys(TERMINAL_DATA_OVERRIDES));

// compare identifiers by canonical utf-8 bytes
const compareTerminalIds = (
  left: StoredAutomaticTerminalRegionV1,
  right: StoredAutomaticTerminalRegionV1
): number =>
  Buffer.compare(Buffer.from(left.terminalId), Buffer.from(right.terminalId));

// reject non-record stored values
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// require safe non-negative policy durations
const requireDuration = (value: number, allowZero: boolean): number => {
  // reject unsafe or negative values
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  return value;
};

// require positive integer platform budgets
const requireBudget = (value: number): number => {
  // reject non-positive budgets
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  return value;
};

// normalize bigint-backed generations safely
const configGenerationNumber = (value: number | string): number => {
  const normalized = typeof value === "string" ? Number(value) : value;
  // reject lossy or invalid generations
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new AutomaticTerminalConfigError("invalid_generation");
  }
  return normalized;
};

// construct only safe finite database timestamps
const dateFromSafeMilliseconds = (value: number): Date => {
  // reject arithmetic overflow and unsupported Date ranges
  if (!Number.isSafeInteger(value)) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  const date = new Date(value);
  // reject invalid Date construction
  if (!Number.isFinite(date.getTime())) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  return date;
};

// canonicalize with fixed fail-closed errors
const canonicalRegionBytes = (
  regions: AutomaticTerminalRegionV1[]
): Uint8Array => {
  // normalize shared validation failures
  try {
    return canonicalAutomaticTerminalRegionBytesV1(regions);
  } catch {
    throw new AutomaticTerminalConfigError("noncanonical_region_json");
  }
};

// hash the exact canonical region bytes
const regionContentHash = (regions: AutomaticTerminalRegionV1[]): string =>
  createHash("sha256").update(canonicalRegionBytes(regions)).digest("hex");

// serialize geometry without generation metadata
const canonicalRegionJson = (regions: AutomaticTerminalRegionV1[]): string =>
  Buffer.from(canonicalRegionBytes(regions)).toString("utf8");

// enforce one complete platform-owned region set
const validateRegionSet = (
  regions: AutomaticTerminalRegionV1[],
  budgets: AutomaticTerminalPlatformBudgets
): AutomaticTerminalRegionV1[] => {
  const androidRegionBudget = requireBudget(budgets.androidRegionBudget);
  const iosRegionBudget = requireBudget(budgets.iosRegionBudget);
  // reject incomplete platform coverage
  if (
    regions.length > androidRegionBudget ||
    regions.length > iosRegionBudget
  ) {
    throw new AutomaticTerminalConfigError("over_platform_budget");
  }
  const terminalIds = new Set<string>();
  // validate every owned region
  for (const region of regions) {
    // reject duplicate public identifiers
    if (terminalIds.has(region.terminalId)) {
      throw new AutomaticTerminalConfigError("duplicate_terminal");
    }
    terminalIds.add(region.terminalId);
    // reject malformed scaled coordinates
    if (
      !Number.isSafeInteger(region.latitudeE7) ||
      !Number.isSafeInteger(region.longitudeE7) ||
      region.latitudeE7 < -900_000_000 ||
      region.latitudeE7 > 900_000_000 ||
      region.longitudeE7 < -1_800_000_000 ||
      region.longitudeE7 > 1_800_000_000
    ) {
      throw new AutomaticTerminalConfigError("invalid_coordinate");
    }
    // reject malformed platform radii
    if (
      !Number.isSafeInteger(region.radiusMillimeters) ||
      region.radiusMillimeters <= 0
    ) {
      throw new AutomaticTerminalConfigError("invalid_radius");
    }
    configGenerationNumber(region.configGeneration);
  }
  // reject missing canonical terminal ids
  if (terminalIds.size !== expectedTerminalIds.size) {
    throw new AutomaticTerminalConfigError("incomplete_terminal_set");
  }
  // reject unexpected canonical terminal ids
  for (const terminalId of terminalIds) {
    // reject any identifier outside the canonical set
    if (!expectedTerminalIds.has(terminalId)) {
      throw new AutomaticTerminalConfigError("incomplete_terminal_set");
    }
  }
  return [...regions].sort(compareTerminalIds);
};

// derive regions only from hydrated runtime terminals
export const deriveAutomaticTerminalRegions = (
  configGeneration: number,
  options: Pick<
    AutomaticTerminalConfigGenerationOptions,
    "androidRegionBudget" | "iosRegionBudget" | "radiusMillimeters"
  >
): AutomaticTerminalRegionV1[] => {
  const generation = configGenerationNumber(configGeneration);
  const radiusMillimeters =
    options.radiusMillimeters ?? AUTOMATIC_TERMINAL_RADIUS_MILLIMETERS;
  // reject the radius before reading runtime data
  if (!Number.isSafeInteger(radiusMillimeters) || radiusMillimeters <= 0) {
    throw new AutomaticTerminalConfigError("invalid_radius");
  }
  const terminals = Terminal.getAll();
  const terminalValues = Object.values(terminals);
  // reject absent WSF hydration
  if (terminalValues.length === 0) {
    throw new AutomaticTerminalConfigError("empty_terminal_set");
  }
  const regions: AutomaticTerminalRegionV1[] = [];
  // copy each hydrated terminal into scaled public geometry
  for (const terminal of terminalValues) {
    // reject sparse overrides
    if (
      typeof terminal.id !== "string" ||
      terminal.id.length === 0 ||
      !terminal.location
    ) {
      throw new AutomaticTerminalConfigError("sparse_terminal");
    }
    const { latitude, longitude } = terminal.location;
    // reject invalid source coordinates before scaling
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new AutomaticTerminalConfigError("invalid_coordinate");
    }
    regions.push({
      configGeneration: generation,
      latitudeE7: Math.round(latitude * 10_000_000),
      longitudeE7: Math.round(longitude * 10_000_000),
      radiusMillimeters,
      terminalId: terminal.id,
    });
  }
  return validateRegionSet(regions, options);
};

// derive the minimum immutable-generation retention window
export const automaticTerminalConfigRetentionMs = (
  candidateRetentionMs: number,
  futureToleranceMs: number,
  transportRetentionMs: number
): number => {
  const candidate = requireDuration(candidateRetentionMs, false);
  const future = requireDuration(futureToleranceMs, true);
  const transport = requireDuration(transportRetentionMs, true);
  const retention = candidate + future + transport;
  // reject overflow in the retention formula
  if (!Number.isSafeInteger(retention)) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  return retention;
};

// parse and revalidate immutable stored bytes
const hydrateStoredConfig = (
  row: StoredConfigRow,
  budgets: AutomaticTerminalPlatformBudgets
): LoadedAutomaticTerminalConfig => {
  const configGeneration = configGenerationNumber(row.configGeneration);
  // reject incompatible durable schemas
  if (row.schemaVersion !== AUTOMATIC_TERMINAL_CONFIG_SCHEMA_VERSION) {
    throw new AutomaticTerminalConfigError("stale_schema");
  }
  let parsed: unknown;
  // convert invalid json into a fixed readiness failure
  try {
    parsed = JSON.parse(row.regionJson);
  } catch {
    throw new AutomaticTerminalConfigError("noncanonical_region_json");
  }
  // reject non-list durable geometry
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AutomaticTerminalConfigError("noncanonical_region_json");
  }
  const regions: AutomaticTerminalRegionV1[] = [];
  // rebuild stored geometry with its immutable generation
  for (const value of parsed) {
    // reject malformed stored records
    if (
      !isRecord(value) ||
      typeof value.terminalId !== "string" ||
      typeof value.latitudeE7 !== "number" ||
      typeof value.longitudeE7 !== "number" ||
      typeof value.radiusMillimeters !== "number" ||
      Object.keys(value).length !== 4
    ) {
      throw new AutomaticTerminalConfigError("noncanonical_region_json");
    }
    regions.push({
      configGeneration,
      latitudeE7: value.latitudeE7,
      longitudeE7: value.longitudeE7,
      radiusMillimeters: value.radiusMillimeters,
      terminalId: value.terminalId,
    });
  }
  const validatedRegions = validateRegionSet(regions, budgets);
  // reject reordered or noncanonical stored bytes
  if (canonicalRegionJson(validatedRegions) !== row.regionJson) {
    throw new AutomaticTerminalConfigError("noncanonical_region_json");
  }
  // reject bytes whose durable digest changed
  if (regionContentHash(validatedRegions) !== row.contentHash) {
    throw new AutomaticTerminalConfigError("hash_mismatch");
  }
  return {
    activatedAt: new Date(row.activatedAt),
    configGeneration,
    contentHash: row.contentHash,
    generatedAt: new Date(row.generatedAt),
    regionJson: row.regionJson,
    regions: validatedRegions,
    retainUntil: new Date(row.retainUntil),
    schemaVersion: AUTOMATIC_TERMINAL_CONFIG_SCHEMA_VERSION,
  };
};

// insert a new generation even when geometry repeats
export const createAutomaticTerminalConfigGeneration = async (
  options: AutomaticTerminalConfigGenerationOptions
): Promise<LoadedAutomaticTerminalConfig> => {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  // reject invalid generation clocks
  if (!Number.isSafeInteger(nowMs)) {
    throw new AutomaticTerminalConfigError("invalid_policy");
  }
  const candidateRetentionMs =
    options.candidateRetentionMs ?? AUTOMATIC_TERMINAL_CANDIDATE_RETENTION_MS;
  const retentionMs = automaticTerminalConfigRetentionMs(
    candidateRetentionMs,
    options.futureToleranceMs,
    options.transportRetentionMs
  );
  // serialize allocation and insertion under one table lock
  return await db.transaction(async (transaction: Transaction) => {
    await db.query(
      'LOCK TABLE "LeaderboardAutomaticTerminalConfigs" IN EXCLUSIVE MODE',
      { transaction }
    );
    const latest = (await LeaderboardAutomaticTerminalConfig.findOne({
      attributes: ["configGeneration"],
      order: [["configGeneration", "DESC"]],
      transaction,
    })) as StoredConfigRow | null;
    const previousGeneration = latest
      ? configGenerationNumber(latest.configGeneration)
      : 0;
    const configGeneration = previousGeneration + 1;
    // reject unsafe generation rollover
    if (!Number.isSafeInteger(configGeneration)) {
      throw new AutomaticTerminalConfigError("generation_exhausted");
    }
    const regions = deriveAutomaticTerminalRegions(configGeneration, options);
    const regionJson = canonicalRegionJson(regions);
    const contentHash = regionContentHash(regions);
    const activatedAt = dateFromSafeMilliseconds(nowMs);
    const generatedAt = dateFromSafeMilliseconds(nowMs);
    const retainUntil = dateFromSafeMilliseconds(nowMs + retentionMs);
    const row = (await LeaderboardAutomaticTerminalConfig.create(
      {
        activatedAt,
        configGeneration,
        contentHash,
        generatedAt,
        regionJson,
        retainUntil,
        schemaVersion: AUTOMATIC_TERMINAL_CONFIG_SCHEMA_VERSION,
      },
      { transaction }
    )) as unknown as StoredConfigRow;
    return hydrateStoredConfig(row, options);
  });
};

// load the exact historical generation without runtime regeneration
export const loadAutomaticTerminalConfigGeneration = async (
  configGeneration: number,
  budgets: AutomaticTerminalPlatformBudgets = defaultPlatformBudgets,
  transaction?: Transaction
): Promise<LoadedAutomaticTerminalConfig> => {
  const generation = configGenerationNumber(configGeneration);
  // bind proof reads to their receipt transaction
  const row = (await (transaction
    ? LeaderboardAutomaticTerminalConfig.findByPk(generation, { transaction })
    : LeaderboardAutomaticTerminalConfig.findByPk(
        generation
      ))) as StoredConfigRow | null;
  // fail closed when durable history is absent
  if (!row) {
    throw new AutomaticTerminalConfigError("missing_durable_config");
  }
  return hydrateStoredConfig(row, budgets);
};

// load the latest durable generation for readiness
export const loadCurrentAutomaticTerminalConfig = async (
  budgets: AutomaticTerminalPlatformBudgets = defaultPlatformBudgets,
  now = new Date()
): Promise<LoadedAutomaticTerminalConfig> => {
  const row = (await LeaderboardAutomaticTerminalConfig.findOne({
    order: [["configGeneration", "DESC"]],
    where: { activatedAt: { [Op.lte]: now } },
  })) as StoredConfigRow | null;
  // fail closed instead of regenerating on restart
  if (!row) {
    throw new AutomaticTerminalConfigError("missing_durable_config");
  }
  return hydrateStoredConfig(row, budgets);
};

// prune only non-current generations after their durable boundary
export const pruneAutomaticTerminalConfigs = async (
  now = new Date()
): Promise<number> => {
  // serialize current-generation selection with pruning
  return await db.transaction(async (transaction: Transaction) => {
    await db.query(
      'LOCK TABLE "LeaderboardAutomaticTerminalConfigs" IN EXCLUSIVE MODE',
      { transaction }
    );
    const current = (await LeaderboardAutomaticTerminalConfig.findOne({
      attributes: ["configGeneration"],
      order: [["configGeneration", "DESC"]],
      transaction,
    })) as StoredConfigRow | null;
    // keep readiness unchanged when the store is empty
    if (!current) {
      return 0;
    }
    return await LeaderboardAutomaticTerminalConfig.destroy({
      transaction,
      where: {
        configGeneration: {
          [Op.lt]: configGenerationNumber(current.configGeneration),
        },
        retainUntil: { [Op.lte]: now },
      },
    });
  });
};
