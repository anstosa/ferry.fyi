import type {
  AlertRule,
  AlertSubscriptions,
  AppMetadata,
} from "shared/contracts/user";
import wsfCore from "shared/data/wsf-core.json";
import {
  ALERT_SUBSCRIPTION_CHANNEL_IDS,
  createFullDayAlertRule,
  getRouteSubscriptionKey,
  isAlertRule,
  isAlertSubscriptionChannel,
  normalizeAlertRule,
} from "shared/lib/alertSubscriptions";
import { isObject } from "shared/lib/objects";

interface CoreRoute {
  terminalIds: string[];
}

// string list sanitizer
export const getStringList = (input: unknown): string[] | undefined => {
  // string list guard
  if (
    !Array.isArray(input) ||
    !input.every((value) => typeof value === "string")
  ) {
    return undefined;
  }
  return input;
};

// subscription sanitizer
export const getAlertSubscriptions = (
  input: unknown
): AlertSubscriptions | undefined => {
  // subscriptions object guard
  if (!isObject(input)) {
    return undefined;
  }
  const subscriptions: AlertSubscriptions = {};
  Object.entries(input).forEach(([routeKey, channels]) => {
    // channel list guard
    if (!Array.isArray(channels)) {
      return;
    }
    const validChannels = channels.filter(isAlertSubscriptionChannel);
    // empty channel guard
    if (validChannels.length === 0) {
      return;
    }
    subscriptions[routeKey] = Array.from(new Set(validChannels));
  });
  return subscriptions;
};

// rule sanitizer
export const getAlertRules = (input: unknown): AlertRule[] | undefined => {
  // rules list guard
  if (!Array.isArray(input)) {
    return undefined;
  }
  const rules = input
    .filter(isAlertRule)
    .map((rule) => normalizeAlertRule(rule))
    .filter(isAlertRule);
  return rules;
};

// route lookup
const getRouteTerminalGroups = (): string[][] => {
  return Object.values(wsfCore.routes as Record<string, CoreRoute>).map(
    (route) => route.terminalIds
  );
};

// terminal pair lookup
const getTerminalPairGroups = (terminalId: string): string[][] => {
  const pairGroups = getRouteTerminalGroups().flatMap((terminalIds) => {
    // route membership guard
    if (!terminalIds.includes(terminalId)) {
      return [];
    }
    return terminalIds
      .filter((mateId) => mateId !== terminalId)
      .map((mateId) => {
        return [terminalId, mateId];
      });
  });
  // unknown terminal guard
  if (pairGroups.length === 0) {
    return [[terminalId]];
  }
  return pairGroups;
};

// exact rule key
const getRuleSignature = (rule: AlertRule): string => {
  return JSON.stringify({
    channels: [...rule.channels].sort(),
    date: rule.date ?? null,
    daysOfWeek: [...rule.daysOfWeek].sort(),
    endTime: rule.endTime,
    routeKey: rule.routeKey,
    startTime: rule.startTime,
    terminalIds: [...rule.terminalIds].sort(),
  });
};

// duplicate rule cleanup
const mergeAlertRules = (rules: AlertRule[]): AlertRule[] => {
  const rulesById = new Map<string, AlertRule>();
  const signatures = new Set<string>();

  rules.forEach((rule) => {
    const normalizedRule = normalizeAlertRule(rule);
    const signature = getRuleSignature(normalizedRule);
    // duplicate signature guard
    if (signatures.has(signature)) {
      return;
    }
    signatures.add(signature);
    rulesById.set(normalizedRule.id, normalizedRule);
  });

  return Array.from(rulesById.values()).filter(isAlertRule);
};

// old route settings conversion
const getRouteSubscriptionRules = (
  alertSubscriptions: AlertSubscriptions | undefined
): AlertRule[] => {
  return Object.entries(alertSubscriptions ?? {}).map(
    ([routeKey, channels]) => {
      const terminalIds = routeKey.split(":");
      const normalizedRouteKey = getRouteSubscriptionKey(terminalIds);
      return createFullDayAlertRule({
        channels,
        id: `route-alert:${normalizedRouteKey}`,
        routeKey: normalizedRouteKey,
        terminalIds,
      });
    }
  );
};

// old terminal settings conversion
const getTerminalSubscriptionRules = (
  subscribedTerminals: string[] | undefined
): AlertRule[] => {
  return (subscribedTerminals ?? []).flatMap((terminalId) => {
    return getTerminalPairGroups(terminalId).map((terminalIds) => {
      const routeKey = getRouteSubscriptionKey(terminalIds);
      return createFullDayAlertRule({
        channels: ALERT_SUBSCRIPTION_CHANNEL_IDS,
        id: `terminal-alert:${terminalId}:${routeKey}`,
        routeKey,
        terminalIds: [terminalId],
      });
    });
  });
};

// alert metadata conversion
export const normalizeAppMetadata = (input: AppMetadata): AppMetadata => {
  const alertRules = mergeAlertRules([
    ...(getAlertRules(input.alertRules) ?? []),
    ...getRouteSubscriptionRules(
      getAlertSubscriptions(input.alertSubscriptions)
    ),
    ...getTerminalSubscriptionRules(getStringList(input.subscribedTerminals)),
  ]);
  const metadata: AppMetadata = {};

  // alert rule guard
  if (alertRules.length > 0 || Array.isArray(input.alertRules)) {
    metadata.alertRules = alertRules;
  }

  // ticket guard
  if (Array.isArray(input.tickets)) {
    metadata.tickets = input.tickets.filter((ticket) => {
      return typeof ticket === "string";
    });
  }

  // token guard
  if (typeof input.fcmToken === "string" || input.fcmToken === null) {
    metadata.fcmToken = input.fcmToken;
  }

  // route favorites guard
  if (Array.isArray(input.favoriteRouteIds)) {
    metadata.favoriteRouteIds = Array.from(
      new Set(
        input.favoriteRouteIds.filter((routeId) => typeof routeId === "string")
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  return metadata;
};

// metadata change guard
export const hasAppMetadataChanged = (
  currentMetadata: AppMetadata,
  nextMetadata: AppMetadata
): boolean => {
  return JSON.stringify(currentMetadata) !== JSON.stringify(nextMetadata);
};
