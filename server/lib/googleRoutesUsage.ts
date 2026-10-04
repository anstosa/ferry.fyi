import { Op, type Transaction } from "sequelize";

import {
  type GoogleRoutesSku,
  GoogleRoutesUsageMonth,
} from "~/models/GoogleRoutesUsageMonth";

export type { GoogleRoutesSku } from "~/models/GoogleRoutesUsageMonth";

export interface GoogleRoutesUsageHandle {
  month: string;
  sku: GoogleRoutesSku;
}

export interface GoogleRoutesUsageSnapshot extends GoogleRoutesUsageHandle {
  attemptCount: number;
  estimatedBillable: number;
  knownFailureCount: number;
  successCount: number;
  unresolvedCount: number;
}

export interface GoogleRoutesUsageAlertEvent {
  estimatedBillable: number;
  month: string;
  sku: GoogleRoutesSku;
  threshold: 80 | 100;
}

export interface GoogleRoutesUsageStore {
  complete(
    handle: GoogleRoutesUsageHandle,
    outcome: "known-failure" | "success"
  ): Promise<void>;
  list(month: string): Promise<GoogleRoutesUsageSnapshot[]>;
  open(sku: GoogleRoutesSku, at: Date): Promise<GoogleRoutesUsageHandle>;
}

export const GOOGLE_ROUTES_USAGE_LIMITS = {
  autocomplete_requests: { reached100: 10_000, reached80: 8_000 },
  compute_routes_essentials: { reached100: 10_000, reached80: 8_000 },
  compute_routes_pro: { reached100: 5_000, reached80: 4_000 },
} as const;

/** Returns the Google billing month at the documented Pacific boundary. */
export function getGoogleRoutesPacificMonth(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

/** Converts a durable row into the privacy-safe exporter shape. */
export function toGoogleRoutesUsageSnapshot(
  row: Pick<
    GoogleRoutesUsageMonth,
    "attemptCount" | "knownFailureCount" | "month" | "sku" | "successCount"
  >
): GoogleRoutesUsageSnapshot {
  const unresolvedCount = Math.max(
    0,
    row.attemptCount - row.successCount - row.knownFailureCount
  );
  return {
    attemptCount: row.attemptCount,
    // received failures are not proof that Google will waive billing
    estimatedBillable: row.attemptCount,
    knownFailureCount: row.knownFailureCount,
    month: row.month,
    sku: row.sku,
    successCount: row.successCount,
    unresolvedCount,
  };
}

/** Creates atomic month accounting with origin-free threshold events. */
export function createGoogleRoutesUsageStore(
  dependencies: {
    emitAlert?: (event: GoogleRoutesUsageAlertEvent) => void;
    model?: typeof GoogleRoutesUsageMonth;
  } = {}
): GoogleRoutesUsageStore {
  const model = dependencies.model ?? GoogleRoutesUsageMonth;
  const emitAlert = dependencies.emitAlert ?? ((event) => console.info(event));

  return {
    // preserve the original month and sku through completion
    async complete(handle, outcome) {
      const field =
        outcome === "success" ? "successCount" : "knownFailureCount";
      await model.increment(field, {
        by: 1,
        where: { month: handle.month, sku: handle.sku },
      });
    },

    // return only bounded aggregate fields
    async list(month) {
      const rows = await model.findAll({
        order: [["sku", "ASC"]],
        where: { month },
      });
      return rows.map(toGoogleRoutesUsageSnapshot);
    },

    // increment attempts before provider I/O
    async open(sku, at) {
      const month = getGoogleRoutesPacificMonth(at);
      const handle = { month, sku };
      // require a transaction-capable store before opening an attempt
      if (!model.sequelize) {
        throw new Error("Google Routes usage store is unavailable");
      }
      await model.sequelize.transaction(async (transaction: Transaction) => {
        const [row] = await model.findOrCreate({
          defaults: {
            attemptCount: 0,
            knownFailureCount: 0,
            month,
            reached100At: null,
            reached80At: null,
            sku,
            successCount: 0,
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
          where: { month, sku },
        });
        await row.increment("attemptCount", { by: 1, transaction });
        await row.reload({ transaction });
        // retain every attempt until nonbillability can be established
        const estimatedBillable = row.attemptCount;
        const limits = GOOGLE_ROUTES_USAGE_LIMITS[sku];
        // mark the 80 percent transition once
        if (estimatedBillable >= limits.reached80 && !row.reached80At) {
          row.reached80At = at;
          emitAlert({ estimatedBillable, month, sku, threshold: 80 });
        }
        // mark the 100 percent transition once
        if (estimatedBillable >= limits.reached100 && !row.reached100At) {
          row.reached100At = at;
          emitAlert({ estimatedBillable, month, sku, threshold: 100 });
        }
        await row.save({ transaction });
      });
      return handle;
    },
  };
}

export const googleRoutesUsageStore = createGoogleRoutesUsageStore();
export const googleRoutesUsage = googleRoutesUsageStore;

// read this month's rows while retaining zero-value sku heartbeats
export async function readCurrentGoogleRoutesUsage(
  at = new Date()
): Promise<GoogleRoutesUsageSnapshot[]> {
  const month = getGoogleRoutesPacificMonth(at);
  const existing = await googleRoutesUsageStore.list(month);
  const bySku = new Map(existing.map((snapshot) => [snapshot.sku, snapshot]));
  const snapshots: GoogleRoutesUsageSnapshot[] = [];
  // publish routes and autocomplete series before their first request
  for (const sku of Object.keys(
    GOOGLE_ROUTES_USAGE_LIMITS
  ) as GoogleRoutesSku[]) {
    snapshots.push(
      bySku.get(sku) ?? {
        attemptCount: 0,
        estimatedBillable: 0,
        knownFailureCount: 0,
        month,
        sku,
        successCount: 0,
        unresolvedCount: 0,
      }
    );
  }
  return snapshots;
}

/** Deletes only aggregates older than the 400-day retention horizon. */
export async function deleteExpiredGoogleRoutesUsage(
  cutoffMonth: string
): Promise<number> {
  return await GoogleRoutesUsageMonth.destroy({
    where: { month: { [Op.lt]: cutoffMonth } },
  });
}
