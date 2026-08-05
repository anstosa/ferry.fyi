import { Message } from "firebase-admin/messaging";
import { DateTime } from "luxon";
import type {
  AlertRule,
  AlertSubscriptionChannel,
} from "shared/contracts/user";
import {
  hasAlertRuleSubscription,
  isOneTimeSailingAlertRuleForSailing,
} from "shared/lib/alertSubscriptions";

import {
  hasAppMetadataChanged,
  normalizeAppMetadata,
} from "~/lib/alertMetadata";
import { UserSettings } from "~/models/UserSettings";

import { createPushMessage } from "./pushMessage";

interface SubscribedTerminalPushInput {
  channel?: AlertSubscriptionChannel;
  currentTime?: DateTime;
  data: Record<string, string>;
  departureTerminalId?: string;
  departureTimes?: number[];
  oneTimeOnly?: boolean;
  terminalIds: string[];
}

interface CompletedOneTimeSailingInput {
  routeKey: string;
  sailingTime: DateTime;
  terminalId: string;
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
    messages.push(
      createPushMessage({
        data,
        token,
        userId: user.subject,
      })
    );
  }
  return messages;
};

// completed one-time rule cleanup
export const removeCompletedOneTimeSailingAlertRules = async ({
  routeKey,
  sailingTime,
  terminalId,
}: CompletedOneTimeSailingInput): Promise<void> => {
  const users = await UserSettings.findAll();
  // settings row scan
  for (const user of users) {
    const appMetadata = await normalizeUserSettings(user);
    const alertRules = appMetadata.alertRules ?? [];
    const nextAlertRules = alertRules.filter((rule) => {
      // completed sailing guard
      return !isOneTimeSailingAlertRuleForSailing(rule, {
        routeKey,
        sailingTime,
        terminalId,
      });
    });
    // unchanged rules guard
    if (nextAlertRules.length === alertRules.length) {
      continue;
    }
    await user.update({
      appMetadata: {
        ...appMetadata,
        alertRules: nextAlertRules,
      },
    });
  }
};
