import React, { ReactElement } from "react";

// current-time divider
export const NowDivider = (): ReactElement => (
  <li
    aria-label="Current time"
    className="h-4 bg-blue-medium flex items-center justify-center"
  >
    <span className="text-white text-xs font-bold leading-none tracking-wide">
      NOW
    </span>
  </li>
);
