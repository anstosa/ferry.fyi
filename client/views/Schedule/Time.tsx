import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";

import type { ProjectedTiming } from "./projectedTiming";

interface Props {
  time: DateTime;
  isNext: boolean;
  timing: ProjectedTiming;
}

export const Time = ({ isNext, time, timing }: Props): ReactElement => {
  const { delayMins, departureTime, isCancelled } = timing;
  const hasDeparted = departureTime.toMillis() < time.toMillis();
  const diff = departureTime.diff(time);

  let majorTime;
  let minorTime;
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
        <span className="text-2xl">{mins}</span>{" "}
        <span className="text-sm">min{mins === 1 ? "" : "s"}</span>
      </span>
    );
    minorTime = departureTime.toFormat("h:mm a");
    isRelativeDeparture = true;
  } else {
    majorTime = departureTime.toFormat("h:mm");
    minorTime = departureTime.toFormat("a");
  }

  let color = "text-black dark:text-white";
  // cancelled color
  if (isCancelled) {
    color = "text-red-dark dark:text-red-light";
  } else if (hasDeparted && delayMins >= 4) {
    // past late color
    color = "text-red-dark dark:text-red-light";
  } else if (hasDeparted) {
    // past on-time color
    color = "text-gray-dark dark:text-gray-medium";
  } else if (delayMins > 0) {
    // late departure color
    color = "text-red-dark dark:text-red-light";
  } else if (delayMins <= -4) {
    // early departure color
    color = "text-yellow-dark dark:text-yellow-medium";
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
      className={clsx("flex flex-col", "text-center w-16 z-0", color, weight)}
    >
      <span
        className={clsx(
          "flex-grow leading-none",
          !isRelativeDeparture && "text-2xl",
          isRelativeDeparture && "whitespace-nowrap",
          "flex flex-col justify-center"
        )}
      >
        {majorTime}
      </span>
      <span className={clsx("text-sm")}>{minorTime}</span>
    </div>
  );
};
