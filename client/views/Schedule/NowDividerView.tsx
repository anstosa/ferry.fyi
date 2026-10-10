import type { DateTime } from "luxon";
import React, { type ReactElement } from "react";

interface Props {
  time: DateTime;
}

// keep the current ferry time as a compact sailing boundary
export const NowDivider = ({ time }: Props): ReactElement => (
  <li aria-label="Current time" className="bg-now-bar text-white">
    <div className="flex h-7 items-center justify-center gap-2 px-3 text-xs font-medium">
      <span className="font-bold">Now</span>
      <time dateTime={time.toISO() ?? undefined} className="tabular-nums">
        {time.setZone("America/Los_Angeles").toFormat("h:mm a")}
      </time>
    </div>
  </li>
);
