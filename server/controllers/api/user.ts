import { Router } from "express";
import { AppMetadata, UserUpdatePayload } from "shared/contracts/user";
import { isObject } from "shared/lib/objects";

import { auth0, Auth0UserUpdate } from "~/lib/auth0";

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
  return response.send(user.data);
});

userRouter.post("/", async (request, response) => {
  const user = await auth0.users.update(
    response.locals.user.sub,
    sanitizeUserUpdate(request.body) as Auth0UserUpdate
  );
  return response.send(user.data);
});

export { sanitizeUserUpdate, userRouter };
