import type { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";

interface Props {
  navigationPath?: string;
  time: DateTime;
}

// pair the current ferry time with the leave-now trip entry
export const NowDivider = ({ navigationPath, time }: Props): ReactElement => (
  <li aria-label="Current time" className="flex flex-col bg-now-bar text-white">
    <div className="flex h-7 items-center justify-center gap-2 px-3 text-xs font-medium">
      <span className="font-bold">Now</span>
      <time dateTime={time.toISO() ?? undefined} className="tabular-nums">
        {time.setZone("America/Los_Angeles").toFormat("h:mm a")}
      </time>
    </div>
    {/* offer leave-now navigation only for the current service day */}
    {navigationPath && (
      <Link
        to={navigationPath}
        className="flex min-h-11 items-center justify-center border-t border-white/20 px-3 text-sm font-semibold transition hover:bg-white/10 active:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
      >
        What boat will I make?
      </Link>
    )}
  </li>
);
