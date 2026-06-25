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

export const Time = ({
  context,
  isNext,
  rowState,
  time,
  timing,
}: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled } = timing;
  const hasDeparted = departureTime.toMillis() < time.toMillis();
  const diff = departureTime.diff(time);

  let majorTime;
  let majorTimeClass = getScheduleTimeMajorClassName(context, rowState);
  let minorTime;
  let minorTimeClass = getScheduleTimeMinorClassName(context, rowState);
  let isRelativeDeparture = false;
  // cancelled sailing
  if (isCancelled) {
    majorTime = "--";
    minorTime = "";
  } else if (
    !hasDeparted &&
    diff.as("minutes") >= 0 &&
    diff.as("minutes") < 60
  ) {
    const mins = Math.round(diff.as("minutes"));
    majorTime = (
      <span className="whitespace-nowrap">
        <span className="text-[17px]">{mins}</span>{" "}
        <span className="text-[17px]">min{mins === 1 ? "" : "s"}</span>
      </span>
    );
    majorTimeClass = "text-countdown";
    minorTime = departureTime.toFormat("h:mm a");
    isRelativeDeparture = true;
  } else {
    majorTime = departureTime.toFormat("h:mm");
    minorTime = departureTime.toFormat("a");
  }

  // cancelled color
  if (isCancelled) {
    majorTimeClass = getLateTextClassName();
    minorTimeClass = getLateTextClassName();
  } else if (hasDeparted && delayMins >= 4) {
    // past late color
    majorTimeClass = getLateTextClassName();
  } else if (delayMins > 0) {
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
      <span className={clsx("text-sm", minorTimeClass)}>{minorTime}</span>
    </div>
  );
};
