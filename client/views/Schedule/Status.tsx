import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";
import { pluralize } from "shared/lib/strings";

import { isLateForSummary } from "./delayThreshold";
import type { ProjectedTiming } from "./projectedTiming";
import { getLateTextClassName } from "./scheduleColors";

interface Props {
  className?: string;
  time: DateTime;
  timing: ProjectedTiming;
}

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
    statusText = "";
  } else if (isLateForSummary(delayMins) || delayMins < 0) {
    // delayed sailing label
    const direction = delayMins < 0 ? "ahead" : "late";
    statusText = `${pluralize(Math.abs(delayMins), "min")} ${direction}`;
    statusClass = clsx(
      statusClass,
      "font-bold",
      isLateForSummary(delayMins) ? getLateTextClassName() : textYellow
    );
    // late scheduled time
    if (isLateForSummary(delayMins)) {
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
