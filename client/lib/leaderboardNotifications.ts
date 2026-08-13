import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import { isNativeMobileApp } from "~/lib/device";
import {
  formatLeaderboardCheckinBody,
  formatLeaderboardCheckinTargetBody,
  LEADERBOARD_CHECKIN_NOTIFICATION_ID,
  leaderboardCheckinAndroidChannel,
  type LeaderboardCheckInKind,
  leaderboardCheckinNotification,
  mergeLeaderboardCheckinNames,
} from "~/lib/leaderboardNotificationConfig";
import { requestPermissionIfNeeded } from "~/lib/permissions";
import { getNotificationPermission } from "~/lib/push";

let activeBrowserNotification: Notification | null = null;
let creditedEntityNames: string[] = [];

/** check-in notification presentation options */
interface LeaderboardCheckInNotificationOptions {
  kind: LeaderboardCheckInKind;
  summarizeRecent?: boolean;
}

/**
 * native platforms only merge a prior alert when the operating system provides
 * its delivered body after restart; otherwise the stable ID replaces it safely.
 */
const mergedCheckinBody = (
  entityName: string,
  summarizeRecent: boolean,
  kind: LeaderboardCheckInKind,
  deliveredBody?: string
): string => {
  // replace standard alerts with the current target
  if (!summarizeRecent) {
    creditedEntityNames = [];
    return formatLeaderboardCheckinTargetBody(entityName, kind);
  }
  creditedEntityNames = mergeLeaderboardCheckinNames(
    entityName,
    deliveredBody,
    creditedEntityNames
  );
  return formatLeaderboardCheckinBody(
    entityName,
    true,
    creditedEntityNames,
    kind
  );
};

/** replace the prior active check-in alert with a concise, silent summary */
export const notifyLeaderboardCheckIn = async (
  entityName: string,
  { kind, summarizeRecent = false }: LeaderboardCheckInNotificationOptions
): Promise<void> => {
  // native notification path
  if (isNativeMobileApp()) {
    const granted = await requestPermissionIfNeeded(
      "display",
      () => LocalNotifications.checkPermissions(),
      () => LocalNotifications.requestPermissions()
    );
    if (!granted) {
      return;
    }
    if (Capacitor.getPlatform() === "android") {
      // Android 8+ sound/vibration come from the channel, not `silent`.
      await LocalNotifications.createChannel(leaderboardCheckinAndroidChannel);
    }
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const prior = delivered.notifications.find(
      ({ id }) => id === LEADERBOARD_CHECKIN_NOTIFICATION_ID
    );
    const body = mergedCheckinBody(
      entityName,
      summarizeRecent,
      kind,
      typeof prior?.body === "string" ? prior.body : undefined
    );
    await Promise.all([
      LocalNotifications.cancel({
        notifications: [{ id: LEADERBOARD_CHECKIN_NOTIFICATION_ID }],
      }),
      LocalNotifications.removeDeliveredNotifications({
        notifications: delivered.notifications.filter(
          ({ id }) => id === LEADERBOARD_CHECKIN_NOTIFICATION_ID
        ),
      }),
    ]);
    await LocalNotifications.schedule({
      notifications: [
        leaderboardCheckinNotification(body, Capacitor.getPlatform()),
      ],
    });
    return;
  }

  const body = mergedCheckinBody(entityName, summarizeRecent, kind);
  if (
    getNotificationPermission() !== "granted" ||
    !("Notification" in window)
  ) {
    return;
  }
  activeBrowserNotification?.close();
  activeBrowserNotification = new Notification("Ferry FYI check-in", {
    body,
    silent: true,
  });
};
