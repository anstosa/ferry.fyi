import { Message } from "firebase-admin/messaging";

import { firebaseMessaging, hasFirebaseCode } from "./firebase";
import { delay } from "./time";

const MAX_RETRY_TIME = 10 * 1000;
const PERMANENT_TOKEN_ERRORS = [
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
  "messaging/registration-token-not-registered",
] as const;

export type PushSendResult =
  | { providerSubmission: "accepted" }
  | {
      providerSubmission: "not-submitted";
      reason: "failed" | "paused" | "unavailable";
    };

type QueuedPush = {
  message: Message;
  resolve: (result: PushSendResult) => void;
};

const pushQueue: QueuedPush[] = [];
let draining = false;

const resultFor = (
  reason: "failed" | "paused" | "unavailable"
): PushSendResult => ({ providerSubmission: "not-submitted", reason });

const isPermanentTokenError = (error: unknown): boolean =>
  PERMANENT_TOKEN_ERRORS.some((code) => hasFirebaseCode(error, code));

const clearRejectedToken = async (message: Message): Promise<void> => {
  if (!message.data?.userId) {
    return;
  }
  const { UserSettings } = await import("~/models/UserSettings");
  const settings = await UserSettings.findByPk(message.data.userId);
  if (settings) {
    await settings.update({
      appMetadata: {
        ...(settings.appMetadata ?? {}),
        fcmToken: null,
      },
    });
  }
};

/**
 * The single final Firebase boundary. Policy is read immediately before every
 * provider submission, including a retry after the message was queued.
 */
const submitPush = async (message: Message): Promise<PushSendResult> => {
  let retryTime = 1;
  while (true) {
    try {
      const { getNotificationPolicy } =
        await import("~/lib/admin/notificationPolicy");
      if ((await getNotificationPolicy()).paused) {
        return resultFor("paused");
      }
    } catch {
      // Do not send when the globally shared policy cannot be read.
      return resultFor("unavailable");
    }

    try {
      await firebaseMessaging.send(message);
      return { providerSubmission: "accepted" };
    } catch (error: unknown) {
      if (hasFirebaseCode(error, "messaging/provider-unavailable")) {
        return resultFor("unavailable");
      }
      if (isPermanentTokenError(error)) {
        await clearRejectedToken(message);
        return resultFor("failed");
      }
      if (retryTime > MAX_RETRY_TIME) {
        console.warn("Permanent push failure; provider submission abandoned");
        return resultFor("failed");
      }
      retryTime *= 2;
      console.warn(`Temporary push failure; retrying in ${retryTime / 1000}s`);
      await delay(retryTime);
    }
  }
};

const recordStatus = async (result: PushSendResult): Promise<void> => {
  const { notificationFinished } =
    await import("~/lib/admin/notificationStatus");
  await notificationFinished(
    result.providerSubmission === "accepted" ? "accepted" : result.reason
  );
};

const trySend = async (): Promise<void> => {
  if (draining) {
    return;
  }
  draining = true;
  try {
    while (pushQueue.length > 0) {
      const queuedPush = pushQueue.shift();
      if (!queuedPush) {
        continue;
      }
      try {
        const { notificationDequeued } =
          await import("~/lib/admin/notificationStatus");
        await notificationDequeued();
      } catch {
        // Aggregate observability must not prevent a queued notification.
      }
      let result: PushSendResult;
      try {
        result = await submitPush(queuedPush.message);
      } catch {
        // Do not leak provider/database details into the operational dashboard.
        result = resultFor("failed");
      }
      try {
        await recordStatus(result);
      } catch {
        // Aggregate observability must not alter provider-boundary semantics.
      }
      queuedPush.resolve(result);
    }
  } finally {
    draining = false;
  }
};

/**
 * Queues a push for the shared provider boundary. "accepted" means Firebase
 * accepted the submission; it never claims recipient delivery.
 */
export const sendPush = (message: Message): Promise<PushSendResult> =>
  new Promise((resolve) => {
    Promise.resolve()
      .then(async () => {
        try {
          const { notificationQueued } =
            await import("~/lib/admin/notificationStatus");
          await notificationQueued();
        } catch {
          // Aggregate observability must not prevent a queued notification.
        }
      })
      .then(() => {
        pushQueue.push({ message, resolve });
        return trySend();
      })
      .catch(() => undefined);
  });
