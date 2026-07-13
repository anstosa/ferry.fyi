import React, { type ReactElement } from "react";

// current-time divider
export const NowDivider = (): ReactElement => (
  <li
    aria-label="Current time"
    className="h-7 bg-now-bar flex items-center justify-center"
  >
    <span className="text-white text-[11px] font-medium leading-none tracking-[0.07em]">
      NOW
    </span>
  </li>
);
