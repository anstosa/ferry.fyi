import { Message } from "firebase-admin/messaging";

import { UserSettings } from "~/models/UserSettings";

import { firebaseMessaging, hasFirebaseCode } from "./firebase";
import { delay } from "./time";

const MAX_RERTY_TIME = 10 * 1000;

let retryTime = 1;
const pushQueue: Message[] = [];

const trySend = async (): Promise<void> => {
  while (pushQueue.length > 0) {
    const message = pushQueue.shift();
    if (!message) {
      continue;
    }
    try {
      await firebaseMessaging.send(message);
      retryTime = 1;
    } catch (error: unknown) {
      if (
        hasFirebaseCode(error, "messaging/registration-token-not-registered")
      ) {
        console.warn(
          `Deleting expired push token for user ${message.data?.userId}`
        );
        if (message.data?.userId) {
          const settings = await UserSettings.findByPk(message.data.userId);
          // settings guard
          if (settings) {
            await settings.update({
              appMetadata: {
                ...(settings.appMetadata ?? {}),
                fcmToken: null,
              },
            });
          }
        }
      } else if (retryTime <= MAX_RERTY_TIME) {
        retryTime *= 2;
        pushQueue.unshift(message);
        console.warn(
          `Temporary push failure, waiting ${retryTime / 1000}secs`,
          message,
          error
        );
        await delay(retryTime);
      } else {
        retryTime = 1;
        console.warn(
          "Permanent push failure, dropping message",
          message,
          error
        );
      }
      retryTime = Math.min(retryTime * 2, MAX_RERTY_TIME);
    }
  }
};

export const sendPush = async (message: Message): Promise<void> => {
  pushQueue.push(message);
  return await trySend();
};
