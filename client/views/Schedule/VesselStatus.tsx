import { DateTime } from "luxon";
import { degreesToHeading } from "~/lib/compass";
import { knotsToMph } from "~/lib/speed";
import { locationToUrl } from "~/lib/maps";
import { pluralize } from "shared/lib/strings";
import clsx from "clsx";
import React, { ReactElement } from "react";
import type { Vessel } from "shared/contracts/vessels";

interface Props {
  className?: string;
  vessel: Vessel;
  time: DateTime;
}

export const VesselStatus = ({
  className,
  vessel,
  time,
}: Props): ReactElement => {
  const { dockedTime, isAtDock, location, heading, speed, vesselWatchUrl } =
    vessel;

  let statusText: string;
  let detailText: string | undefined;
  if (isAtDock) {
    statusText = "Docked";
    if (dockedTime) {
      const delta = DateTime.fromSeconds(dockedTime).diff(time);
      const deltaMins = delta.as("minutes");
      detailText = `${pluralize(deltaMins, "min")} ago`;
    }
  } else {
    statusText = "Sailing";
    detailText = `${knotsToMph(speed)}mph ${
      (heading && degreesToHeading(heading)) || ""
    }`;
  }

  return (
    <a
      className={clsx("link text-sm", className)}
      href={vesselWatchUrl ?? (location && locationToUrl(location))}
    >
      <span>{statusText}</span>
      {detailText && (
        <>
          {" · "}
          <span>{detailText}</span>
        </>
      )}
    </a>
  );
};
