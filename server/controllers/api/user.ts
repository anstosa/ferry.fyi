import { Router } from "express";
import {
  AlertSubscriptions,
  AppMetadata,
  UserUpdatePayload,
} from "shared/contracts/user";
import { isAlertSubscriptionChannel } from "shared/lib/alertSubscriptions";
import { isObject } from "shared/lib/objects";

import { auth0, Auth0UserUpdate } from "~/lib/auth0";

const userRouter = Router();

// auth0 response data
const getAuth0Data = <T>(input: T | { data?: T }): T | undefined => {
  // v5 response guard
  if (isObject(input) && "data" in input) {
    return input.data as T | undefined;
  }
  return input as T;
};

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

const sanitizeUserUpdate = (input: unknown): UserUpdatePayload => {
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

userRouter.get("/", async (request, response) => {
  const user = await auth0.users.get(response.locals.user.sub);
  return response.send(getAuth0Data(user));
});

userRouter.post("/", async (request, response) => {
  const user = await auth0.users.update(
    response.locals.user.sub,
    sanitizeUserUpdate(request.body) as Auth0UserUpdate
  );
  return response.send(getAuth0Data(user));
});

export { sanitizeUserUpdate, userRouter };
