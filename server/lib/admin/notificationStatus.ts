import { Transaction } from "sequelize";

import { db } from "~/lib/db";
import { NotificationRuntimeStatus } from "~/models/NotificationRuntimeStatus";

import { getNotificationPolicy } from "./notificationPolicy";

export const NOTIFICATION_STATUS_TTL_MS = 5 * 60 * 1000;

export type NotificationChannel = "push";
export type NotificationRequestResult =
  | "accepted"
  | "failed"
  | "paused"
  | "unavailable";

type NotificationChannelDashboard = {
  inFlight: number;
  queueState: "active" | "not-queued";
  queued: number;
  requestResult: NotificationRequestResult | null;
};

const defaultStatus = (channel: NotificationChannel) => ({
  channel,
  expiresAt: null,
  inFlightCount: 0,
  queuedCount: 0,
  requestResult: null,
});

const isExpired = (row: NotificationRuntimeStatus, now: Date): boolean =>
  row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();

const resetExpired = async (
  row: NotificationRuntimeStatus,
  transaction: Transaction
): Promise<void> => {
  await row.update(
    {
      expiresAt: null,
      inFlightCount: 0,
      queuedCount: 0,
      requestResult: null,
    },
    { transaction }
  );
};

const getLockedStatus = async (
  channel: NotificationChannel,
  transaction: Transaction
): Promise<NotificationRuntimeStatus> => {
  await NotificationRuntimeStatus.findOrCreate({
    defaults: defaultStatus(channel),
    transaction,
    where: { channel },
  });
  const row = await NotificationRuntimeStatus.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { channel },
  });
  if (!row) {
    throw new Error("Notification runtime status row was not created");
  }
  return row;
};

const updateStatus = async (
  channel: NotificationChannel,
  update: (row: NotificationRuntimeStatus) => Record<string, unknown>,
  now = new Date()
): Promise<void> => {
  await db.transaction(async (transaction) => {
    const row = await getLockedStatus(channel, transaction);
    if (isExpired(row, now)) {
      await resetExpired(row, transaction);
    }
    await row.update(
      {
        ...update(row),
        expiresAt: new Date(now.getTime() + NOTIFICATION_STATUS_TTL_MS),
      },
      { transaction }
    );
  });
};

const toDashboard = (
  row?: NotificationRuntimeStatus | null
): NotificationChannelDashboard => {
  if (!row) {
    return {
      inFlight: 0,
      queueState: "not-queued",
      queued: 0,
      requestResult: null,
    };
  }
  const queued = Math.max(0, row.queuedCount);
  const inFlight = Math.max(0, row.inFlightCount);
  return {
    inFlight,
    queueState: queued + inFlight > 0 ? "active" : "not-queued",
    queued,
    requestResult: row.requestResult,
  };
};

/** Current cross-process operational state, never delivery or audit history. */
export const getNotificationDashboard = async (): Promise<{
  channels: Record<NotificationChannel, NotificationChannelDashboard>;
  inFlight: number;
  policy: { paused: boolean };
  queueState: "active" | "not-queued";
  queued: number;
  requestResult: NotificationRequestResult | null;
}> => {
  const now = new Date();
  const row = await NotificationRuntimeStatus.findByPk("push");
  const expired = row && isExpired(row, now);
  if (expired && row) {
    await db.transaction((transaction) => resetExpired(row, transaction));
  }
  const push = toDashboard(expired ? null : row);
  return {
    channels: { push },
    // Transitional aliases while push is the only send channel.
    inFlight: push.inFlight,
    policy: await getNotificationPolicy(),
    queueState: push.queueState,
    queued: push.queued,
    requestResult: push.requestResult,
  };
};

export const notificationQueued = (
  channel: NotificationChannel = "push"
): Promise<void> =>
  updateStatus(channel, (row) => ({ queuedCount: row.queuedCount + 1 }));

export const notificationDequeued = (
  channel: NotificationChannel = "push"
): Promise<void> =>
  updateStatus(channel, (row) => ({
    inFlightCount: row.inFlightCount + 1,
    queuedCount: Math.max(0, row.queuedCount - 1),
  }));

export const notificationFinished = (
  status: NotificationRequestResult,
  channel: NotificationChannel = "push"
): Promise<void> =>
  updateStatus(channel, (row) => ({
    inFlightCount: Math.max(0, row.inFlightCount - 1),
    requestResult: status,
  }));
