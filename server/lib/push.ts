import { delay } from "./time";
import { firebase } from "./firebase";
import { Message } from "firebase-admin/messaging";

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
      await firebase.messaging().send(message);
      retryTime = 1;
    } catch (error) {
      if (retryTime <= MAX_RERTY_TIME) {
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
      console.warn("Failed to send push: ", message, error);
    }
  }
};

export const sendPush = async (message: Message): Promise<void> => {
  pushQueue.push(message);
  return await trySend();
};
