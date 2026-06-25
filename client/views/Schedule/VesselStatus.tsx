import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";
import type { Vessel } from "shared/contracts/vessels";
import { pluralize } from "shared/lib/strings";

import { degreesToHeading } from "~/lib/compass";
import { locationToUrl } from "~/lib/maps";
import { knotsToMph } from "~/lib/speed";

import { getLateTextClassName } from "./scheduleColors";
import { getRoundedEtaMinutes, roundStatusNumber } from "./vesselStatus";

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
  const {
    dockedTime,
    estimatedArrivalTime,
    isAtDock,
    location,
    heading,
    speed,
    vesselWatchUrl,
  } = vessel;

  let statusText: string;
  let detailText: string | undefined;
  let etaText: string | undefined;
  let lateText: string | undefined;
  // late sailing guard
  if (delayMins > 0) {
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
    const etaMins = getRoundedEtaMinutes(estimatedArrivalTime, time);
    // eta availability guard
    if (etaMins !== null) {
      etaText = `ETA ${pluralize(etaMins, "min")}`;
    }
    statusText = "Sailing";
    detailText = `${roundStatusNumber(knotsToMph(speed))}mph ${
      (heading && degreesToHeading(heading)) || ""
    }`;
  }

  return (
    <a
      className={clsx(
        "text-sm no-underline",
        (etaText || lateText) && "inline-flex flex-col items-end",
        className
      )}
      href={vesselWatchUrl ?? (location && locationToUrl(location))}
    >
      {lateText && (
        <span className={clsx("font-bold", getLateTextClassName())}>
          {lateText}
        </span>
      )}
      {etaText && (
        <span className={clsx("font-bold", lateText && "mt-1")}>{etaText}</span>
      )}
      <span className={clsx((etaText || lateText) && "mt-1")}>
        <span>{statusText}</span>
        {detailText && (
          <>
            {" · "}
            <span>{detailText}</span>
          </>
        )}
      </span>
    </a>
  );
};
