import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";
import { pluralize } from "shared/lib/strings";

import type { ProjectedTiming } from "./projectedTiming";

interface Props {
  className?: string;
  time: DateTime;
  timing: ProjectedTiming;
}

const textGreen = "text-green-dark dark:text-green-light";
const textRed = "text-red-dark dark:text-red-light";
const textYellow = "text-yellow-dark dark:text-yellow-medium";

export const Status = ({ className, time, timing }: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled, scheduledTime } = timing;
  const hasDeparted = departureTime.toMillis() < time.toMillis();
  const formattedScheduledTime = `${scheduledTime.toFormat("h:mm a")}`;
  const diff = departureTime.diff(time);

  let statusText;
  let statusClass = hasDeparted ? "font-default" : "font-medium";
  let scheduled;

  // cancelled sailing
  if (isCancelled) {
    scheduled = formattedScheduledTime;
    statusText = "Cancelled";
    statusClass = clsx(statusClass, "font-bold uppercase", textRed);
  } else if (Math.abs(delayMins) > 0) {
    // delayed sailing label
    const direction = delayMins < 0 ? "ahead" : "behind";
    statusText = `${pluralize(Math.abs(delayMins), "min")} ${direction}`;
    statusClass = clsx(
      statusClass,
      "font-bold",
      delayMins > 0 ? textRed : textYellow
    );
    scheduled = `Scheduled ${formattedScheduledTime}`;
  } else {
    statusText = "";
    statusClass = clsx(statusClass, !hasDeparted && textGreen);
    // upcoming scheduled label
    if (!hasDeparted && diff.as("minutes") >= 0 && diff.as("minutes") < 60) {
      scheduled = `Scheduled ${formattedScheduledTime}`;
    }
  }

  return (
    <span className={clsx(className, "text-sm")}>
      {scheduled}
      {scheduled && statusText && " · "}
      {statusText && <span className={statusClass}>{statusText}</span>}
    </span>
  );
};
