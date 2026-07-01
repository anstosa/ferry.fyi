import { Router } from "express";
import {
  AlertSubscriptions,
  AppMetadata,
  CurrentUser,
  UserUpdatePayload,
} from "shared/contracts/user";
import { isAlertSubscriptionChannel } from "shared/lib/alertSubscriptions";
import { isObject } from "shared/lib/objects";

import { UserSettings } from "~/models/UserSettings";

const userRouter = Router();

const getStringList = (input: unknown): string[] | undefined => {
  // string list guard
  if (
    !Array.isArray(input) ||
    !input.every((value) => typeof value === "string")
  ) {
    return undefined;
  }
  return input;
};

const getAlertSubscriptions = (
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

const sanitizeAppMetadata = (input: unknown): AppMetadata | undefined => {
  // metadata object guard
  if (!isObject(input)) {
    return undefined;
  }
  const metadata: AppMetadata = {};
  const tickets = getStringList(input.tickets);
  // tickets allow-list
  if (tickets) {
    metadata.tickets = tickets;
  }
  const alertSubscriptions = getAlertSubscriptions(input.alertSubscriptions);
  // alert subscriptions allow-list
  if (alertSubscriptions) {
    metadata.alertSubscriptions = alertSubscriptions;
  }
  const subscribedTerminals = getStringList(input.subscribedTerminals);
  // subscription allow-list
  if (subscribedTerminals) {
    metadata.subscribedTerminals = subscribedTerminals;
  }
  // fcm token allow-list
  if (typeof input.fcmToken === "string" || input.fcmToken === null) {
    metadata.fcmToken = input.fcmToken;
  }
  // empty metadata guard
  if (Object.keys(metadata).length === 0) {
    return undefined;
  }
  return metadata;
};

export const sanitizeUserUpdate = (input: unknown): UserUpdatePayload => {
  // payload object guard
  if (!isObject(input)) {
    return {};
  }
  const payload: UserUpdatePayload = {};
  const appMetadata = sanitizeAppMetadata(input.app_metadata);
  // app metadata guard
  if (appMetadata) {
    payload.app_metadata = appMetadata;
  }
  return payload;
};

// find or create app settings
const getUserSettings = async (subject: string): Promise<UserSettings> => {
  const [settings] = await UserSettings.findOrCreate({
    defaults: { appMetadata: {}, subject },
    where: { subject },
  });
  return settings;
};

// user response body
const serializeUserSettings = (settings: UserSettings): CurrentUser => {
  return {
    app_metadata: settings.appMetadata ?? {},
    user_id: settings.subject,
  };
};

userRouter.get("/", async (request, response) => {
  const settings = await getUserSettings(response.locals.user.sub);
  return response.send(serializeUserSettings(settings));
});

userRouter.post("/", async (request, response) => {
  const settings = await getUserSettings(response.locals.user.sub);
  const update = sanitizeUserUpdate(request.body);
  const appMetadata = {
    ...(settings.appMetadata ?? {}),
    ...(update.app_metadata ?? {}),
  };
  await settings.update({ appMetadata });
  return response.send(serializeUserSettings(settings));
});

export { userRouter };
