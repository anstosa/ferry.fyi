export type AlertSubscriptionChannel =
  | "cancellations"
  | "delays"
  | "sailing-updates"
  | "service-alerts"
  | "wait-times";

export type AlertSubscriptions = Record<string, AlertSubscriptionChannel[]>;

export interface AlertRule {
  channels: AlertSubscriptionChannel[];
  date?: string;
  daysOfWeek: number[];
  endTime: string;
  id: string;
  routeKey: string;
  startTime: string;
  terminalIds: string[];
}

export interface AppMetadata {
  alertRules?: AlertRule[];
  alertSubscriptions?: AlertSubscriptions;
  tickets?: string[];
  subscribedTerminals?: string[];
  fcmToken?: string | null;
}

export type UserMetadata = Record<string, unknown>;

export interface CurrentUser extends Record<string, unknown> {
  app_metadata?: AppMetadata;
  favoriteRouteIds?: string[];
  user_metadata?: UserMetadata;
}

export interface UserUpdatePayload extends Record<string, unknown> {
  app_metadata?: AppMetadata;
  favoriteRouteIds?: string[];
}
