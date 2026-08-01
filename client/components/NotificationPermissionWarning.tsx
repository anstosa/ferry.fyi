import clsx from "clsx";
import React, { FunctionComponent, useEffect, useState } from "react";

import {
  getNotificationPermission,
  requestNotificationPermission,
  requestPushInitialization,
} from "~/lib/push";
import BellSlashIcon from "~/static/images/icons/solid/bell-slash.svg";

interface Props {
  className?: string;
  hasAlerts: boolean;
}

export const NotificationPermissionWarning: FunctionComponent<Props> = ({
  className,
  hasAlerts,
}) => {
  const [permission, setPermission] = useState(getNotificationPermission);
  const [isRequesting, setRequesting] = useState(false);

  useEffect(() => {
    const refreshPermission = (): void => {
      const nextPermission = getNotificationPermission();
      setPermission(nextPermission);
      if (nextPermission === "granted") {
        requestPushInitialization();
      }
    };
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);

  if (!hasAlerts || permission === "granted" || permission === null) {
    return null;
  }

  const requestPermissions = async (): Promise<void> => {
    setRequesting(true);
    try {
      const granted = await requestNotificationPermission();
      setPermission(getNotificationPermission());
      if (granted) {
        requestPushInitialization();
      }
    } finally {
      setPermission(getNotificationPermission());
      setRequesting(false);
    }
  };

  return (
    <section
      className={clsx(
        "rounded-2xl border border-stale-light bg-stale-light/10 p-4 text-gray-darkest",
        "dark:border-stale-dark dark:bg-stale-dark/20 dark:text-white",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <BellSlashIcon className="mt-0.5 h-5 w-5 shrink-0 text-stale-dark dark:text-stale-light" />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">
            {permission === "denied"
              ? "Notifications are blocked"
              : "Enable notifications"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed">
            {permission === "denied"
              ? "Your alerts are saved, but Ferry FYI cannot notify you until notification permission is allowed in your app or browser settings."
              : "Your alerts are saved. Allow notifications so Ferry FYI can deliver them."}
          </p>
          {permission === "default" ? (
            <button
              className="button button-primary mt-3 hover:bg-green-dark"
              disabled={isRequesting}
              onClick={() => requestPermissions()}
              type="button"
            >
              {isRequesting ? "Requesting permission…" : "Allow notifications"}
            </button>
          ) : (
            <p className="mt-2 text-xs opacity-80">
              After changing the permission in settings, return to Ferry FYI.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
