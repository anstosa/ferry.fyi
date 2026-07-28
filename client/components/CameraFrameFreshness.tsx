import React, { type ReactElement } from "react";
import type { CameraFrameStatus } from "shared/contracts/cameraFrames";

import { FreshnessPill } from "./FreshnessPill";

interface CameraFrameFreshnessProps {
  frameStatus?: CameraFrameStatus;
  now?: number;
  /** Avoid live-region announcements for automatically-polled camera rows. */
  passive?: boolean;
}

const className =
  "shrink-0 border-0 bg-transparent !p-0 text-xs font-bold text-[#0e1e2a] " +
  "dark:bg-white dark:text-[#0e1e2a]";

/** Shows the source image age, or the most recent successful camera check. */
export const CameraFrameFreshness = ({
  frameStatus,
  now,
  passive = false,
}: CameraFrameFreshnessProps): ReactElement => {
  // Initial fetch guard
  if (!frameStatus) {
    return (
      <span
        aria-live={passive ? undefined : "polite"}
        className={className}
        role={passive ? undefined : "status"}
      >
        Checking image…
      </span>
    );
  }

  const sourceUpdatedAt = frameStatus.frameUpdatedAt;
  // Unknown source timestamp guard
  if (!Number.isFinite(sourceUpdatedAt)) {
    return (
      <FreshnessPill
        className={className}
        now={now}
        passive={passive}
        sourceUpdatedAt={frameStatus.checkedAt}
        verb="Checked"
      />
    );
  }

  return (
    <FreshnessPill
      className={className}
      now={now}
      passive={passive}
      sourceUpdatedAt={sourceUpdatedAt}
    />
  );
};
