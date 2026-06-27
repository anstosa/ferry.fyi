import { Message } from "firebase-admin/messaging";

import { auth0 } from "./auth0";

interface SubscribedTerminalPushInput {
  data: Record<string, string>;
  terminalIds: string[];
}

// subscribed terminal messages
export const getSubscribedTerminalPushMessages = async ({
  data,
  terminalIds,
}: SubscribedTerminalPushInput): Promise<Message[]> => {
  const users = await auth0.users.list({ search_engine: "v3" });
  const messages: Message[] = [];
  // auth0 user page
  for await (const user of users) {
    const subscribedTerminals = user.app_metadata?.subscribedTerminals;
    const token = user.app_metadata?.fcmToken;
    // subscription metadata guard
    if (!Array.isArray(subscribedTerminals)) {
      continue;
    }
    const isSubscribed = terminalIds.some((terminalId) => {
      return subscribedTerminals.includes(terminalId);
    });
    // route subscription guard
    if (!isSubscribed) {
      continue;
    }
    // token guard
    if (typeof token !== "string") {
      console.warn("Subscribed user without FCM Token", user.user_id);
      continue;
    }
    messages.push({
      token,
      data: {
        ...data,
        userId: user.user_id ?? "",
      },
    });
  }
  return messages;
};
