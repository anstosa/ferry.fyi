export interface AppMetadata {
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
