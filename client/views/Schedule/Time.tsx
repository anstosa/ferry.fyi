import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";

import type { ProjectedTiming } from "./projectedTiming";
import {
  getLateTextClassName,
  getScheduleTimeMajorClassName,
  getScheduleTimeMinorClassName,
  type ScheduleRowState,
  type ScheduleSailingContext,
} from "./scheduleColors";

interface Props {
  time: DateTime;
  isNext: boolean;
  context: ScheduleSailingContext;
  rowState: ScheduleRowState;
  timing: ProjectedTiming;
}

// render schedule time
export const Time = ({
  context,
  isNext,
  rowState,
  time,
  timing,
}: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled, scheduledTime } = timing;
  const displayDepartureTime = isCancelled ? scheduledTime : departureTime;
  const hasDeparted = displayDepartureTime.toMillis() < time.toMillis();
  const diff = displayDepartureTime.diff(time);

  let majorTime;
  let majorTimeClass = getScheduleTimeMajorClassName(context, rowState);
  let minorTime;
  const minorTimeClass = getScheduleTimeMinorClassName(context, rowState);
  let isRelativeDeparture = false;
  // cancelled sailing
  if (isCancelled) {
    majorTime = scheduledTime.toFormat("h:mm");
    minorTime = scheduledTime.toFormat("a");
  } else if (
    !hasDeparted &&
    diff.as("minutes") >= 0 &&
    diff.as("minutes") < 60
  ) {
    const mins = Math.round(diff.as("minutes"));
    majorTime = (
      <span className="inline-flex items-baseline justify-center whitespace-nowrap leading-none">
        <span className="text-[28px] leading-none">{mins}</span>
        <span className="ml-0.5 text-[10px] font-medium leading-none">
          min{mins === 1 ? "" : "s"}
        </span>
      </span>
    );
    majorTimeClass = "text-countdown";
    minorTime = displayDepartureTime.toFormat("h:mm a");
    isRelativeDeparture = true;
  } else {
    majorTime = displayDepartureTime.toFormat("h:mm");
    minorTime = displayDepartureTime.toFormat("a");
  }

  // late color
  if (!isCancelled && hasDeparted && delayMins >= 4) {
    // past late color
    majorTimeClass = getLateTextClassName();
  } else if (!isCancelled && delayMins > 0) {
    // late departure color
    majorTimeClass = getLateTextClassName();
  } else if (delayMins <= -4) {
    // early departure color
    majorTimeClass = "text-yellow-dark dark:text-yellow-medium";
  }

  let weight;
  // past weight
  if (hasDeparted) {
    weight = "font-default";
  } else if (isNext) {
    // next sailing weight
    weight = "font-bold";
  } else {
    weight = "font-medium";
  }
  return (
    <div className={clsx("flex flex-col", "text-center w-16 z-0", weight)}>
      <span
        className={clsx(
          "flex-grow leading-none",
          !isRelativeDeparture && "text-2xl",
          isRelativeDeparture && "font-medium",
          isRelativeDeparture && "whitespace-nowrap",
          majorTimeClass,
          "flex flex-col justify-center"
        )}
      >
        {majorTime}
      </span>
      <span
        className={clsx(
          "text-sm",
          isRelativeDeparture && "whitespace-nowrap text-[11px]",
          minorTimeClass
        )}
      >
        {minorTime}
      </span>
    </div>
  );
};
