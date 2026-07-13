import clsx from "clsx";
import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type { Vessel } from "shared/contracts/vessels";
import { pluralize } from "shared/lib/strings";

import { degreesToHeading } from "~/lib/compass";
import { knotsToMph } from "~/lib/speed";

import { isLateForSummary } from "./delayThreshold";
import { getLateTextClassName } from "./scheduleColors";
import { roundStatusNumber } from "./vesselStatus";

interface Props {
  className?: string;
  delayMins?: number;
  vessel: Vessel;
  time: DateTime;
}

export const VesselStatus = ({
  className,
  delayMins = 0,
  vessel,
  time,
}: Props): ReactElement => {
  const { dockedTime, isAtDock, heading, speed } = vessel;

  let statusText: string;
  let detailText: string | undefined;
  let lateText: string | undefined;
  // late sailing guard
  if (isLateForSummary(delayMins)) {
    lateText = `${pluralize(roundStatusNumber(delayMins), "min")} late`;
  }
  if (isAtDock) {
    statusText = "Docked";
    if (dockedTime) {
      const delta = DateTime.fromSeconds(dockedTime).diff(time);
      const deltaMins = roundStatusNumber(delta.as("minutes"));
      detailText = `${pluralize(deltaMins, "min")} ago`;
    }
  } else {
    statusText = "Sailing";
    detailText = `${roundStatusNumber(knotsToMph(speed))}mph ${
      (heading && degreesToHeading(heading)) || ""
    }`;
  }

  const content = (
    <>
      {lateText && (
        <span className={clsx("font-bold", getLateTextClassName())}>
          {lateText}
        </span>
      )}
      <span className={clsx(lateText && "mt-1")}>
        <span>{statusText}</span>
        {detailText && (
          <>
            {" · "}
            <span>{detailText}</span>
          </>
        )}
      </span>
    </>
  );
  const statusClassName = clsx(
    "text-sm no-underline",
    lateText && "inline-flex flex-col items-end",
    className
  );
  return <span className={statusClassName}>{content}</span>;
};
