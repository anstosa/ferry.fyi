import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";
import { pluralize } from "shared/lib/strings";

import type { ProjectedTiming } from "./projectedTiming";
import { getLateTextClassName } from "./scheduleColors";

interface Props {
  className?: string;
  time: DateTime;
  timing: ProjectedTiming;
}

const textRed = "text-red-dark dark:text-red-light";
const textYellow = "text-yellow-dark dark:text-yellow-medium";

export const Status = ({ className, time, timing }: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled, scheduledTime } = timing;
  const hasDeparted = departureTime.toMillis() < time.toMillis();
  const formattedScheduledTime = `${scheduledTime.toFormat("h:mm a")}`;

  let statusText;
  let statusClass = hasDeparted ? "font-default" : "font-medium";
  let scheduled;

  // cancelled sailing
  if (isCancelled) {
    statusText = "Cancelled";
    statusClass = clsx(statusClass, "font-bold uppercase", textRed);
  } else if (Math.abs(delayMins) > 0) {
    // delayed sailing label
    const direction = delayMins < 0 ? "ahead" : "late";
    statusText = `${pluralize(Math.abs(delayMins), "min")} ${direction}`;
    statusClass = clsx(
      statusClass,
      "font-bold",
      delayMins > 0 ? getLateTextClassName() : textYellow
    );
    // late scheduled time
    if (delayMins > 0) {
      scheduled = `Scheduled ${formattedScheduledTime}`;
    }
  } else {
    statusText = "";
  }

  return (
    <span className={clsx(className, "text-sm")}>
      {scheduled}
      {scheduled && statusText && " · "}
      {statusText && <span className={statusClass}>{statusText}</span>}
    </span>
  );
};
