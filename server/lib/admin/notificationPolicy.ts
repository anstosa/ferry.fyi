import { NotificationControl } from "~/models/NotificationControl";

const notificationControlKey = "global";

export type NotificationPolicy = { paused: boolean };

/**
 * Reads the policy from Postgres every time. This is deliberately not cached:
 * a pause must cover sends dequeued by every web or worker process.
 */
export const getNotificationPolicy = async (): Promise<NotificationPolicy> => {
  const [control] = await NotificationControl.findOrCreate({
    defaults: { key: notificationControlKey, paused: false },
    where: { key: notificationControlKey },
  });
  return { paused: control.paused };
};

export const setNotificationsPaused = async (
  paused: boolean
): Promise<NotificationPolicy> => {
  const [control] = await NotificationControl.findOrCreate({
    defaults: { key: notificationControlKey, paused },
    where: { key: notificationControlKey },
  });
  if (control.paused !== paused) {
    await control.update({ paused });
  }
  return { paused };
};

/** A database read failure fails closed rather than allowing a stale send. */
export const canSendNotification = async (): Promise<boolean> =>
  !(await getNotificationPolicy()).paused;
