import { DateTime } from "luxon";

import type { AlertRule, AlertSubscriptionChannel } from "../contracts/user";

export interface AlertSubscriptionChannelOption {
  description: string;
  id: AlertSubscriptionChannel;
  label: string;
}

export interface AlertRuleMatchInput {
  channel?: AlertSubscriptionChannel;
  currentTime?: DateTime;
  departureTerminalId?: string;
  departureTimes?: number[];
  terminalIds: string[];
}

export interface SailingAlertRuleInput {
  channels?: AlertSubscriptionChannel[];
  id: string;
  routeKey: string;
  sailingTime: DateTime;
  terminalIds: string[];
}

const FULL_DAY_START_TIME = "00:00";
const FULL_DAY_END_TIME = "24:00";
const MAX_SECONDS_IN_DAY = 24 * 60 * 60;
const ALERT_TIME_ZONE = "America/Los_Angeles";

export const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
export const WEEKEND_DAYS = [6, 7];
export const EVERY_DAY_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const ONE_TIME_SAILING_ALERT_CHANNELS: AlertSubscriptionChannel[] = [
  "delays",
  "cancellations",
];

export const ALERT_SUBSCRIPTION_CHANNELS: AlertSubscriptionChannelOption[] = [
  {
    description: "GPS-based projected delay threshold and recovery notices.",
    id: "delays",
    label: "Delays",
  },
  {
    description: "Confirmed cancellations and tidal cancellation risks.",
    id: "cancellations",
    label: "Cancellations",
  },
  {
    description: "WSF wait time posts for heavy terminal traffic.",
    id: "wait-times",
    label: "Wait time announcements",
  },
  {
    description: "Other high-impact WSF route and terminal service alerts.",
    id: "service-alerts",
    label: "Service alerts",
  },
];

export const ALERT_SUBSCRIPTION_CHANNEL_IDS = ALERT_SUBSCRIPTION_CHANNELS.map(
  ({ id }) => id
);

// route subscription key
export const getRouteSubscriptionKey = (terminalIds: string[]): string => {
  return [...terminalIds].sort().join(":");
};

// channel validation
export const isAlertSubscriptionChannel = (
  input: unknown
): input is AlertSubscriptionChannel => {
  return (
    typeof input === "string" &&
    ALERT_SUBSCRIPTION_CHANNEL_IDS.includes(input as AlertSubscriptionChannel)
  );
};

// channel label lookup
export const getAlertSubscriptionChannelLabel = (
  channel: AlertSubscriptionChannel
): string => {
  return (
    ALERT_SUBSCRIPTION_CHANNELS.find(({ id }) => id === channel)?.label ??
    channel
  );
};

// subscribed route guard
export const hasRouteSubscription = (
  alertSubscriptions: Record<string, AlertSubscriptionChannel[]> | undefined,
  terminalIds: string[]
): boolean => {
  const routeKey = getRouteSubscriptionKey(terminalIds);
  return (alertSubscriptions?.[routeKey]?.length ?? 0) > 0;
};

// time validation
export const isAlertRuleTime = (input: unknown): input is string => {
  // string guard
  if (typeof input !== "string") {
    return false;
  }
  const match = input.match(/^(\d{2}):(\d{2})$/);
  // format guard
  if (!match) {
    return false;
  }
  const [, hourInput, minuteInput] = match;
  const hour = Number(hourInput);
  const minute = Number(minuteInput);
  // hour guard
  if (hour === 24) {
    return minute === 0;
  }
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
};

// time seconds
export const getAlertRuleTimeSeconds = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 * 60 + minute * 60;
};

// date time label
export const getAlertRuleTimeFromDate = (time: DateTime): string => {
  return time.toFormat("HH:mm");
};

// date label
export const getAlertRuleDateFromDate = (time: DateTime): string => {
  return time.setZone(ALERT_TIME_ZONE).toISODate() ?? time.toISODate() ?? "";
};

// date validation
export const isAlertRuleDate = (input: unknown): input is string => {
  // string guard
  if (typeof input !== "string") {
    return false;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
};

// full-day rule guard
export const isFullDayAlertRule = (rule: AlertRule): boolean => {
  return (
    rule.startTime === FULL_DAY_START_TIME && rule.endTime === FULL_DAY_END_TIME
  );
};

// one-time rule guard
export const isOneTimeAlertRule = (
  rule: AlertRule
): rule is AlertRule & { date: string } => {
  return isAlertRuleDate(rule.date);
};

// rule validation
export const isAlertRule = (input: unknown): input is AlertRule => {
  // object guard
  if (!input || typeof input !== "object") {
    return false;
  }
  const rule = input as AlertRule;
  // scalar guard
  if (
    typeof rule.id !== "string" ||
    typeof rule.routeKey !== "string" ||
    (rule.date !== undefined && !isAlertRuleDate(rule.date)) ||
    !isAlertRuleTime(rule.startTime) ||
    !isAlertRuleTime(rule.endTime)
  ) {
    return false;
  }
  // collection guard
  if (
    !Array.isArray(rule.channels) ||
    !Array.isArray(rule.daysOfWeek) ||
    !Array.isArray(rule.terminalIds)
  ) {
    return false;
  }
  const startSeconds = getAlertRuleTimeSeconds(rule.startTime);
  const endSeconds = getAlertRuleTimeSeconds(rule.endTime);
  return (
    startSeconds <= endSeconds &&
    rule.channels.some(isAlertSubscriptionChannel) &&
    rule.daysOfWeek.length > 0 &&
    rule.daysOfWeek.every(
      (day) => Number.isInteger(day) && day >= 1 && day <= 7
    ) &&
    rule.terminalIds.length > 0 &&
    rule.terminalIds.every((terminalId) => typeof terminalId === "string")
  );
};

// days normalization
export const normalizeAlertRuleDays = (daysOfWeek: number[]): number[] => {
  return Array.from(new Set(daysOfWeek))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((left, right) => left - right);
};

// rule normalization
export const normalizeAlertRule = (rule: AlertRule): AlertRule => {
  const routeTerminalIds = rule.routeKey.split(":");
  const date = isAlertRuleDate(rule.date) ? rule.date : undefined;
  return {
    ...rule,
    channels: Array.from(new Set(rule.channels)).filter(
      isAlertSubscriptionChannel
    ),
    ...(date ? { date } : {}),
    daysOfWeek: normalizeAlertRuleDays(rule.daysOfWeek),
    routeKey: getRouteSubscriptionKey(routeTerminalIds),
    terminalIds: Array.from(new Set(rule.terminalIds)).filter((terminalId) => {
      return routeTerminalIds.includes(terminalId);
    }),
  };
};

// same route guard
export const isRuleForRoute = (
  rule: AlertRule,
  terminalIds: string[]
): boolean => {
  return rule.routeKey === getRouteSubscriptionKey(terminalIds);
};

// time window guard
const isTimeInAlertRuleWindow = (time: DateTime, rule: AlertRule): boolean => {
  const seconds = time.hour * 60 * 60 + time.minute * 60 + time.second;
  const startSeconds = getAlertRuleTimeSeconds(rule.startTime);
  const endSeconds = getAlertRuleTimeSeconds(rule.endTime);
  return (
    seconds >= startSeconds &&
    seconds <= Math.min(endSeconds, MAX_SECONDS_IN_DAY)
  );
};

// date window guard
const isDateInAlertRuleWindow = (time: DateTime, rule: AlertRule): boolean => {
  // recurring rule guard
  if (!isOneTimeAlertRule(rule)) {
    return true;
  }
  return getAlertRuleDateFromDate(time) === rule.date;
};

// rule match guard
const isMatchingAlertRule = (
  rule: AlertRule,
  input: AlertRuleMatchInput
): boolean => {
  // channel guard
  if (!input.channel || !rule.channels.includes(input.channel)) {
    return false;
  }
  const inputRouteKey = getRouteSubscriptionKey(input.terminalIds);
  const isRouteMatch =
    input.terminalIds.length > 1
      ? getRouteSubscriptionKey(rule.routeKey.split(":")) === inputRouteKey
      : rule.routeKey.split(":").includes(input.terminalIds[0]);
  // route guard
  if (!isRouteMatch) {
    return false;
  }
  const departureTerminalId = input.departureTerminalId ?? input.terminalIds[0];
  // terminal guard
  if (!rule.terminalIds.includes(departureTerminalId)) {
    return false;
  }
  const candidateTimes = input.departureTimes?.length
    ? input.departureTimes.map((time) => {
        return DateTime.fromSeconds(time, { zone: ALERT_TIME_ZONE });
      })
    : [input.currentTime ?? DateTime.local()];
  return candidateTimes.some((time) => {
    // date guard
    if (!isDateInAlertRuleWindow(time, rule)) {
      return false;
    }
    // day guard
    if (!rule.daysOfWeek.includes(time.weekday)) {
      return false;
    }
    return isTimeInAlertRuleWindow(time, rule);
  });
};

// alert rule subscription guard
export const hasAlertRuleSubscription = (
  alertRules: AlertRule[] | undefined,
  input: AlertRuleMatchInput
): boolean => {
  return (alertRules ?? []).some((rule) => {
    return isMatchingAlertRule(rule, input);
  });
};

// full-day rule builder
export const createFullDayAlertRule = ({
  channels,
  id,
  routeKey,
  terminalIds,
}: {
  channels: AlertSubscriptionChannel[];
  id: string;
  routeKey: string;
  terminalIds: string[];
}): AlertRule => {
  return {
    channels,
    daysOfWeek: EVERY_DAY_DAYS,
    endTime: FULL_DAY_END_TIME,
    id,
    routeKey,
    startTime: FULL_DAY_START_TIME,
    terminalIds,
  };
};

// one-time sailing rule builder
export const createOneTimeSailingAlertRule = ({
  channels = ONE_TIME_SAILING_ALERT_CHANNELS,
  id,
  routeKey,
  sailingTime,
  terminalIds,
}: SailingAlertRuleInput): AlertRule => {
  const sailingTimeInZone = sailingTime.setZone(ALERT_TIME_ZONE);
  const time = getAlertRuleTimeFromDate(sailingTimeInZone);
  return {
    channels,
    date: getAlertRuleDateFromDate(sailingTimeInZone),
    daysOfWeek: [sailingTimeInZone.weekday],
    endTime: time,
    id,
    routeKey,
    startTime: time,
    terminalIds,
  };
};

// one-time sailing match
export const isOneTimeSailingAlertRuleForSailing = (
  rule: AlertRule,
  {
    routeKey,
    sailingTime,
    terminalId,
  }: {
    routeKey: string;
    sailingTime: DateTime;
    terminalId: string;
  }
): boolean => {
  // one-time guard
  if (!isOneTimeAlertRule(rule)) {
    return false;
  }
  const sailingTimeInZone = sailingTime.setZone(ALERT_TIME_ZONE);
  return (
    rule.routeKey === routeKey &&
    rule.date === getAlertRuleDateFromDate(sailingTimeInZone) &&
    rule.startTime === getAlertRuleTimeFromDate(sailingTimeInZone) &&
    rule.endTime === rule.startTime &&
    rule.terminalIds.includes(terminalId)
  );
};
