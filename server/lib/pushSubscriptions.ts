import { Message } from "firebase-admin/messaging";
import { DateTime } from "luxon";
import type {
  AlertRule,
  AlertSubscriptionChannel,
} from "shared/contracts/user";
import { hasAlertRuleSubscription } from "shared/lib/alertSubscriptions";

import {
  hasAppMetadataChanged,
  normalizeAppMetadata,
} from "~/lib/alertMetadata";
import { UserSettings } from "~/models/UserSettings";

interface SubscribedTerminalPushInput {
  channel?: AlertSubscriptionChannel;
  currentTime?: DateTime;
  data: Record<string, string>;
  departureTerminalId?: string;
  departureTimes?: number[];
  oneTimeOnly?: boolean;
  terminalIds: string[];
}

// scheduled rule match
const hasScheduledRuleSubscription = ({
  alertRules,
  channel,
  currentTime,
  departureTerminalId,
  departureTimes,
  oneTimeOnly,
  terminalIds,
}: {
  alertRules: AlertRule[] | undefined;
  channel?: AlertSubscriptionChannel;
  currentTime?: DateTime;
  departureTerminalId?: string;
  departureTimes?: number[];
  oneTimeOnly?: boolean;
  terminalIds: string[];
}): boolean => {
  return hasAlertRuleSubscription(alertRules, {
    channel,
    currentTime,
    departureTerminalId,
    departureTimes,
    oneTimeOnly,
    terminalIds,
  });
};

// normalize persisted settings
const normalizeUserSettings = async (
  user: UserSettings
): Promise<ReturnType<typeof normalizeAppMetadata>> => {
  const appMetadata = user.appMetadata ?? {};
  const normalizedMetadata = normalizeAppMetadata(appMetadata);
  // stale metadata guard
  if (hasAppMetadataChanged(appMetadata, normalizedMetadata)) {
    await user.update({ appMetadata: normalizedMetadata });
  }
  return normalizedMetadata;
};

// subscribed terminal messages
export const getSubscribedTerminalPushMessages = async ({
  channel,
  currentTime,
  data,
  departureTerminalId,
  departureTimes,
  oneTimeOnly,
  terminalIds,
}: SubscribedTerminalPushInput): Promise<Message[]> => {
  const users = await UserSettings.findAll();
  const messages: Message[] = [];
  // settings row page
  for (const user of users) {
    const appMetadata = await normalizeUserSettings(user);
    const { alertRules, fcmToken: token } = appMetadata;
    const isSubscribed = hasScheduledRuleSubscription({
      alertRules,
      channel,
      currentTime,
      departureTerminalId,
      departureTimes,
      oneTimeOnly,
      terminalIds,
    });
    // route subscription guard
    if (!isSubscribed) {
      continue;
    }
    // token guard
    if (typeof token !== "string") {
      console.warn("Subscribed user without FCM Token", user.subject);
      continue;
    }
    messages.push({
      token,
      data: {
        ...data,
        userId: user.subject,
      },
    });
  }
  return messages;
};
