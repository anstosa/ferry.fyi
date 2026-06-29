export type AlertSubscriptionChannel =
  | "cancellations"
  | "delays"
  | "service-alerts"
  | "wait-times";

export type AlertSubscriptions = Record<string, AlertSubscriptionChannel[]>;

export interface AppMetadata {
  alertSubscriptions?: AlertSubscriptions;
  tickets?: string[];
  subscribedTerminals?: string[];
  fcmToken?: string | null;
}

export type UserMetadata = Record<string, unknown>;

export interface CurrentUser extends Record<string, unknown> {
  app_metadata?: AppMetadata;
  user_metadata?: UserMetadata;
}

export interface UserUpdatePayload extends Record<string, unknown> {
  app_metadata?: AppMetadata;
}
