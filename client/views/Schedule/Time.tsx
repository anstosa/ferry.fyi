import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";

import { isLateForSummary } from "./delayThreshold";
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
  hasDeparted: boolean;
  isExpanded: boolean;
  isNext: boolean;
  context: ScheduleSailingContext;
  rowState: ScheduleRowState;
  timing: ProjectedTiming;
}

// render schedule time
export const Time = ({
  context,
  hasDeparted,
  isExpanded,
  isNext,
  rowState,
  time,
  timing,
}: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled, scheduledTime } = timing;
  const displayDepartureTime = isCancelled ? scheduledTime : departureTime;
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
  if (!isCancelled && hasDeparted && isLateForSummary(delayMins)) {
    // past late color
    majorTimeClass = getLateTextClassName();
  } else if (!isCancelled && isLateForSummary(delayMins)) {
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
    <div
      className={clsx(
        "relative flex -translate-y-1 flex-col pb-3",
        "text-center w-16 z-0",
        weight
      )}
    >
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
      <span
        className={clsx(
          "absolute -bottom-1 left-1/2 w-14 -translate-x-1/2",
          "text-center text-[8px] font-black uppercase leading-none",
          "tracking-[0.08em]",
          "text-green-dark dark:text-green-light"
        )}
      >
        <span>Details</span>
        <svg
          aria-hidden="true"
          className={clsx(
            "absolute -right-1 -top-px h-2 w-2 transition-transform",
            {
              "rotate-180": isExpanded,
            }
          )}
          fill="none"
          viewBox="0 0 8 8"
        >
          <path
            d="M1 2.5 4 5.5 7 2.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.25"
          />
        </svg>
      </span>
    </div>
  );
};
