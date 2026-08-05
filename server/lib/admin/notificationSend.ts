import { Message } from "firebase-admin/messaging";

import { PushSendResult, sendPush } from "~/lib/push";
import { UserSettings } from "~/models/UserSettings";

import { createPushMessage } from "../pushMessage";

export type AdminNotificationMode = "broadcast" | "targeted" | "test";

export interface AdminNotificationInput {
  body: string;
  mode: AdminNotificationMode;
  subject?: string;
  title: string;
}

export interface AdminNotificationPreview {
  recipientCount: number;
}

const hasConsent = (metadata: UserSettings["appMetadata"]): boolean => {
  const rules = metadata?.alertRules ?? [];
  if (
    rules.some((rule) => rule.enabled !== false && rule.channels.length > 0)
  ) {
    return true;
  }
  if (
    Object.values(metadata?.alertSubscriptions ?? {}).some(
      (channels) => channels.length > 0
    )
  ) {
    return true;
  }
  return (metadata?.subscribedTerminals?.length ?? 0) > 0;
};

/**
 * Only users who both supplied a current FCM token and opted into Ferry FYI
 * alerts are eligible. This is deliberately evaluated at send time, not
 * cached in a dashboard or an admin action record.
 */
const recipientsFor = async ({
  mode,
  subject,
}: Pick<AdminNotificationInput, "mode" | "subject">): Promise<
  UserSettings[]
> => {
  if ((mode === "targeted" || mode === "test") && !subject) {
    return [];
  }
  const users = await UserSettings.findAll({
    ...(mode === "broadcast" ? {} : { where: { subject } }),
  });
  return users.filter(
    (user) =>
      typeof user.appMetadata?.fcmToken === "string" &&
      user.appMetadata.fcmToken.length > 0 &&
      hasConsent(user.appMetadata)
  );
};

export const previewAdminNotification = async (
  input: Pick<AdminNotificationInput, "mode" | "subject">
): Promise<AdminNotificationPreview> => ({
  recipientCount: (await recipientsFor(input)).length,
});

const messageFor = (
  user: UserSettings,
  input: Pick<AdminNotificationInput, "body" | "title">
): Message =>
  createPushMessage({
    data: {
      body: input.body,
      title: input.title,
      type: "admin-notice",
      url: process.env.BASE_URL ?? "/",
    },
    token: user.appMetadata.fcmToken as string,
    userId: user.subject,
  });

/**
 * Submits through the one final policy-aware provider gateway. A provider
 * acceptance is intentionally not represented as delivery confirmation.
 */
export const sendAdminNotification = async (
  input: AdminNotificationInput
): Promise<{
  acceptedCount: number;
  delivery: "not-confirmed";
  notSubmittedCount: number;
  recipientCount: number;
}> => {
  const recipients = await recipientsFor(input);
  const results: PushSendResult[] = [];
  for (const user of recipients) {
    results.push(await sendPush(messageFor(user, input)));
  }
  const acceptedCount = results.filter(
    (result) => result.providerSubmission === "accepted"
  ).length;
  return {
    acceptedCount,
    delivery: "not-confirmed",
    notSubmittedCount: results.length - acceptedCount,
    recipientCount: recipients.length,
  };
};
