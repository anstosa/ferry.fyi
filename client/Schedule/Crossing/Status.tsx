import { DateTime, Duration } from "luxon";
import { isDark } from "~/lib/theme";
import { isNull } from "~/lib/identity";
import { round } from "~/lib/math";
import clsx from "clsx";
import React, { FC } from "react";
import type { Slot } from "shared/models/schedules";

interface Props {
  className?: string;
  slot: Slot;
  time: DateTime;
}

const textGreen = isDark ? "text-green-light" : "text-green-dark";
const textRed = isDark ? "text-red-light" : "text-red-dark";
const textYellow = isDark ? "text-yellow-light" : "text-yellow-dark";

export const Status: FC<Props> = (props) => {
  const { className, slot, time } = props;
  const { crossing, hasPassed } = slot;
  const scheduledTime = DateTime.fromSeconds(slot.time);
  const formattedScheduledTime = `${scheduledTime.toFormat("h:mm a")}`;

  let statusText;
  let statusClass = hasPassed ? "font-default" : "font-medium";
  let scheduled;

  if (crossing && !isNull(crossing.departureDelta)) {
    const { departureDelta, isCancelled = false } = crossing;
    const delta = Duration.fromObject({ seconds: departureDelta });
    const deltaMins = round(delta.as("minutes"));
    const estimatedTime = scheduledTime.plus(delta);
    const diff = estimatedTime.diff(time);
    if (isCancelled) {
      scheduled = `${scheduledTime.toFormat("h:mm a")}`;
      statusText = "Cancelled";
      statusClass = clsx(statusClass, "font-bold uppercase", textRed);
    } else if (Math.abs(deltaMins) >= 4) {
      const units = deltaMins === 1 ? "min" : "mins";
      const direction = deltaMins < 0 ? "ahead" : "behind";
      const color = deltaMins < 10 ? textYellow : textRed;
      statusText = `${deltaMins} ${units} ${direction}`;
      statusClass = clsx(statusClass, !hasPassed && color, "font-bold");
      scheduled = `Scheduled ${formattedScheduledTime}`;
    } else {
      statusText = "On time";
      statusClass = clsx(statusClass, !hasPassed && textGreen);
      if (Math.abs(diff.as("hours")) < 1) {
        scheduled = `Scheduled ${formattedScheduledTime}`;
      }
    }
  } else if (Math.abs(scheduledTime.diff(time).as("hours")) < 1) {
    scheduled = formattedScheduledTime;
  }

  return (
    <span className={clsx(className, "text-sm")}>
      {scheduled}
      {scheduled && statusText && " · "}
      {statusText && <span className={statusClass}>{statusText}</span>}
    </span>
  );
};
