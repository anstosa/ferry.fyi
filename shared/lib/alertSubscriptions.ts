import type { AlertSubscriptionChannel } from "../contracts/user";

export interface AlertSubscriptionChannelOption {
  description: string;
  id: AlertSubscriptionChannel;
  label: string;
}

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
