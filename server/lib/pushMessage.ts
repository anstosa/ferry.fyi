import { Message } from "firebase-admin/messaging";

interface PushMessageInput {
  data: Record<string, string>;
  token: string;
  userId: string;
}

const getWebLink = (url: string): string | undefined => {
  try {
    return new URL(url).href;
  } catch {
    try {
      return process.env.BASE_URL
        ? new URL(url, process.env.BASE_URL).href
        : undefined;
    } catch {
      return undefined;
    }
  }
};

/**
 * Composes one cross-platform message. The data payload keeps foreground web
 * handling deterministic, while the display payload lets FCM show alerts when
 * a browser tab or Android app is backgrounded or terminated.
 */
export const createPushMessage = ({
  data,
  token,
  userId,
}: PushMessageInput): Message => {
  const message: Message = {
    data: { ...data, userId },
    token,
  };
  const { body, title, url } = data;
  if (!body || !title || !url) {
    return message;
  }
  message.notification = { body, title };
  message.android = { priority: "high" };
  const link = getWebLink(url);
  if (link) {
    message.webpush = { fcmOptions: { link } };
  }
  return message;
};
