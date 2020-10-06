import { DateTime, Duration } from "luxon";
import { round } from "lodash";
import { Slot } from "../../../server/lib/wsf";
import clsx from "clsx";
import React, { FunctionComponent } from "react";

interface Props {
  slot: Slot;
  time: DateTime;
  isNext: boolean;
}

export const Time: FunctionComponent<Props> = (props) => {
  const { slot, isNext, time } = props;
  const { crossing, hasPassed } = slot;
  const { departureDelta, isCancelled } = crossing || {};
  const delta = Duration.fromObject({ seconds: departureDelta || 0 });
  let deltaMins = round(delta.as("minutes"));
  const scheduledTime = DateTime.fromSeconds(slot.time);
  let estimatedTime = scheduledTime.plus(delta);
  const diff = estimatedTime.diff(time);
  if (Math.abs(deltaMins) <= 2) {
    deltaMins = 0;
    estimatedTime = scheduledTime;
  }

  let majorTime;
  let minorTime;
  if (isCancelled) {
    majorTime = "--";
    minorTime = "";
  } else if (Math.abs(diff.as("hours")) < 1) {
    const mins = round(Math.abs(diff.as("minutes")));
    majorTime = mins;
    minorTime = `min${mins > 1 ? "s" : ""}${hasPassed ? " ago" : ""}`;
  } else {
    majorTime = estimatedTime.toFormat("h:mm");
    minorTime = estimatedTime.toFormat("a");
  }

  let color = "text-black";
  if (isCancelled) {
    color = "text-red-dark";
  } else if (hasPassed) {
    color = "text-gray-dark";
  } else if (deltaMins >= 10) {
    color = "text-red-dark";
  } else if (deltaMins >= 4) {
    color = "text-yellow-dark";
  }

  let weight;
  if (hasPassed) {
    weight = "font-default";
  } else if (isNext) {
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
          "flex-grow text-2xl leading-none",
          "flex flex-col justify-center"
        )}
      >
        {majorTime}
      </span>
      <span className={clsx("text-sm")}>{minorTime}</span>
    </div>
  );
};
