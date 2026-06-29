import { Message } from "firebase-admin/messaging";
import type {
  AlertSubscriptionChannel,
  AlertSubscriptions,
} from "shared/contracts/user";
import { getRouteSubscriptionKey } from "shared/lib/alertSubscriptions";

import { auth0 } from "./auth0";

interface SubscribedTerminalPushInput {
  channel?: AlertSubscriptionChannel;
  data: Record<string, string>;
  terminalIds: string[];
}

// route subscription match
const hasRouteSubscription = ({
  alertSubscriptions,
  channel,
  terminalIds,
}: {
  alertSubscriptions: AlertSubscriptions | undefined;
  channel?: AlertSubscriptionChannel;
  terminalIds: string[];
}): boolean => {
  // channel guard
  if (!channel || !alertSubscriptions) {
    return false;
  }
  const routeKey =
    terminalIds.length > 1 ? getRouteSubscriptionKey(terminalIds) : undefined;
  // exact route guard
  if (routeKey && alertSubscriptions[routeKey]?.includes(channel)) {
    return true;
  }
  return Object.entries(alertSubscriptions).some(
    ([subscriptionKey, channels]) => {
      // channel membership guard
      if (!channels.includes(channel)) {
        return false;
      }
      const subscribedTerminalIds = subscriptionKey.split(":");
      return terminalIds.some((terminalId) => {
        return subscribedTerminalIds.includes(terminalId);
      });
    }
  );
};

// legacy subscription match
const hasLegacyTerminalSubscription = (
  subscribedTerminals: unknown,
  terminalIds: string[]
): boolean => {
  // legacy metadata guard
  if (!Array.isArray(subscribedTerminals)) {
    return false;
  }
  return terminalIds.some((terminalId) => {
    return subscribedTerminals.includes(terminalId);
  });
};

// subscribed terminal messages
export const getSubscribedTerminalPushMessages = async ({
  channel,
  data,
  terminalIds,
}: SubscribedTerminalPushInput): Promise<Message[]> => {
  const users = await auth0.users.list({ search_engine: "v3" });
  const messages: Message[] = [];
  // auth0 user page
  for await (const user of users) {
    const subscribedTerminals = user.app_metadata?.subscribedTerminals;
    const alertSubscriptions = user.app_metadata?.alertSubscriptions as
      | AlertSubscriptions
      | undefined;
    const token = user.app_metadata?.fcmToken;
    const isSubscribed =
      hasLegacyTerminalSubscription(subscribedTerminals, terminalIds) ||
      hasRouteSubscription({ alertSubscriptions, channel, terminalIds });
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
