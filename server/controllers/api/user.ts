import { Router } from "express";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  AppMetadata,
  CurrentUser,
  UserUpdatePayload,
} from "shared/contracts/user";
import { isObject } from "shared/lib/objects";
import { getSavedTicketLookupId } from "shared/lib/tickets";

import {
  ContinuingBillingAcknowledgementRequiredError,
  deleteFerryUserAccount,
} from "~/lib/accountDeletion";
import {
  getAlertRules,
  getAlertSubscriptions,
  getStringList,
  hasAppMetadataChanged,
  normalizeAppMetadata,
} from "~/lib/alertMetadata";
import { getSupporterSummaryForSubject } from "~/lib/supporter";
import { deleteUnsavedUserTickets } from "~/lib/wsf/userTicketCache";
import { UserSettings } from "~/models/UserSettings";

const userRouter = Router();

const normalizeFavoriteRouteIds = (routeIds: unknown): string[] => {
  const stringRouteIds = getStringList(routeIds);
  // valid list guard
  if (!stringRouteIds) {
    return [];
  }
  return Array.from(new Set(stringRouteIds)).sort((left, right) =>
    left.localeCompare(right)
  );
};

const sanitizeAppMetadata = (input: unknown): AppMetadata | undefined => {
  // metadata object guard
  if (!isObject(input)) {
    return undefined;
  }
  const metadata: AppMetadata = {};
  const alertRules = getAlertRules(input.alertRules);
  // alert rules allow-list
  if (alertRules) {
    metadata.alertRules = alertRules;
  }
  const tickets = getStringList(input.tickets);
  // tickets allow-list
  if (tickets) {
    metadata.tickets = tickets;
  }
  const alertSubscriptions = getAlertSubscriptions(input.alertSubscriptions);
  // old route alert conversion
  if (alertSubscriptions) {
    metadata.alertSubscriptions = alertSubscriptions;
  }
  const subscribedTerminals = getStringList(input.subscribedTerminals);
  // old terminal alert conversion
  if (subscribedTerminals) {
    metadata.subscribedTerminals = subscribedTerminals;
  }
  // fcm token allow-list
  if (typeof input.fcmToken === "string" || input.fcmToken === null) {
    metadata.fcmToken = input.fcmToken;
  }
  const normalizedMetadata = normalizeAppMetadata(metadata);
  // empty metadata guard
  if (Object.keys(normalizedMetadata).length === 0) {
    return undefined;
  }
  return normalizedMetadata;
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
  const favoriteRouteIds = getStringList(input.favoriteRouteIds);
  // DB-backed route favorites allow-list
  if (favoriteRouteIds) {
    payload.favoriteRouteIds = normalizeFavoriteRouteIds(favoriteRouteIds);
  }
  return payload;
};

// find or create app settings
const getUserSettings = async (subject: string): Promise<UserSettings> => {
  const [settings] = await UserSettings.findOrCreate({
    defaults: { appMetadata: {}, favoriteRouteIds: [], subject },
    where: { subject },
  });
  return settings;
};

// persisted metadata migration
const getNormalizedAppMetadata = async (
  settings: UserSettings
): Promise<AppMetadata> => {
  const currentMetadata = settings.appMetadata ?? {};
  const nextMetadata = normalizeAppMetadata(currentMetadata);
  // stale metadata guard
  if (hasAppMetadataChanged(currentMetadata, nextMetadata)) {
    await settings.update({ appMetadata: nextMetadata });
  }
  return nextMetadata;
};

// user response body
const serializeUserSettings = (
  settings: UserSettings,
  appMetadata: AppMetadata,
  supporter: CurrentUser["supporter"]
): CurrentUser => {
  return {
    app_metadata: appMetadata,
    favoriteRouteIds: normalizeFavoriteRouteIds(settings.favoriteRouteIds),
    supporter,
    user_id: settings.subject,
  };
};

userRouter.get("/", async (request, response) => {
  const settings = await getUserSettings(response.locals.user.sub);
  const appMetadata = await getNormalizedAppMetadata(settings);
  const supporter = await getSupporterSummaryForSubject(
    response.locals.user.sub
  );
  return response.send(serializeUserSettings(settings, appMetadata, supporter));
});

userRouter.post("/", async (request, response) => {
  const settings = await getUserSettings(response.locals.user.sub);
  const update = sanitizeUserUpdate(request.body);
  const appMetadata = normalizeAppMetadata({
    ...normalizeAppMetadata(settings.appMetadata ?? {}),
    ...(update.app_metadata ?? {}),
  });
  await settings.update({
    appMetadata,
    ...(update.favoriteRouteIds
      ? { favoriteRouteIds: update.favoriteRouteIds }
      : {}),
  });
  if (update.app_metadata?.tickets) {
    await deleteUnsavedUserTickets(
      response.locals.user.sub,
      update.app_metadata.tickets.map(getSavedTicketLookupId)
    );
  }
  const supporter = await getSupporterSummaryForSubject(
    response.locals.user.sub
  );
  return response.send(serializeUserSettings(settings, appMetadata, supporter));
});

userRouter.delete("/", async (request, response) => {
  response.set("Cache-Control", "no-store");
  // destructive confirmation guard
  if (request.body?.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    return response.status(400).send({ error: "confirmation_required" });
  }
  // isolate continuing billing acknowledgement
  try {
    return response.send(
      await deleteFerryUserAccount(
        response.locals.user.sub,
        request.body?.continuingBillingAcknowledged === true
      )
    );
  } catch (error) {
    // billing acknowledgement guard
    if (error instanceof ContinuingBillingAcknowledgementRequiredError) {
      return response.status(409).send({
        error: "continuing_billing_acknowledgement_required",
      });
    }
    throw error;
  }
});

export { userRouter };
