import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import { isNativeMobileApp } from "~/lib/device";
import {
  formatLeaderboardCheckinBody,
  LEADERBOARD_CHECKIN_NOTIFICATION_ID,
  leaderboardCheckinAndroidChannel,
  leaderboardCheckinNotification,
  mergeLeaderboardCheckinNames,
} from "~/lib/leaderboardNotificationConfig";
import { requestPermissionIfNeeded } from "~/lib/permissions";
import { getNotificationPermission } from "~/lib/push";

let activeBrowserNotification: Notification | null = null;
let creditedTerminalNames: string[] = [];

/**
 * Native platforms only merge a prior alert when the operating system provides
 * its delivered body after restart; otherwise the stable ID replaces it safely.
 */
const mergedCheckinBody = (
  terminalName: string,
  verbose: boolean,
  deliveredBody?: string
): string => {
  if (!verbose) {
    // Never leak a terminal name in the default notification, including a
    // delivered verbose summary from before the preference changed.
    creditedTerminalNames = [];
    return formatLeaderboardCheckinBody(terminalName, false);
  }
  creditedTerminalNames = mergeLeaderboardCheckinNames(
    terminalName,
    deliveredBody,
    creditedTerminalNames
  );
  return formatLeaderboardCheckinBody(
    terminalName,
    true,
    creditedTerminalNames
  );
};

/** Replace the prior active check-in alert with a concise, silent summary. */
export const notifyLeaderboardCheckIn = async (
  terminalName: string,
  verbose = false
): Promise<void> => {
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
      terminalName,
      verbose,
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

  const body = mergedCheckinBody(terminalName, verbose);
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
