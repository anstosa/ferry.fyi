import clsx from "clsx";
import React, { FunctionComponent, useState } from "react";

import {
  getNotificationPermission,
  requestNotificationPermission,
  usePush,
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
  const initializePush = usePush(false);
  const [permission, setPermission] = useState(getNotificationPermission);
  const [isRequesting, setRequesting] = useState(false);

  if (!hasAlerts || permission !== "denied") {
    return null;
  }

  const requestPermissionsAgain = async (): Promise<void> => {
    setRequesting(true);
    try {
      if (await requestNotificationPermission(true)) {
        initializePush();
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
          <h2 className="font-bold">Notifications are blocked</h2>
          <p className="mt-1 text-sm leading-relaxed">
            Your alerts are saved, but Ferry FYI cannot notify you until
            notification permission is allowed.
          </p>
          <button
            className="button button-primary mt-3 hover:bg-green-dark"
            disabled={isRequesting}
            onClick={() => requestPermissionsAgain()}
            type="button"
          >
            {isRequesting
              ? "Requesting permission…"
              : "Request permission again"}
          </button>
          <p className="mt-2 text-xs opacity-80">
            If your device does not show a prompt, enable notifications in its
            app or browser settings.
          </p>
        </div>
      </div>
    </section>
  );
};
