import React, { type ReactElement } from "react";
import type {
  CameraFrameStatus,
  PublicSsrCameraFrameStatus,
} from "shared/contracts/cameraFrames";

import { FreshnessPill } from "./FreshnessPill";

interface CameraFrameFreshnessProps {
  frameStatus?: Pick<CameraFrameStatus, "checkedAt"> &
    Partial<Pick<CameraFrameStatus, "error">> &
    Partial<Pick<PublicSsrCameraFrameStatus, "status">>;
  now?: number;
  /** Avoid live-region announcements for automatically-polled camera rows. */
  passive?: boolean;
}

const className =
  "shrink-0 border-0 bg-transparent !p-0 text-xs font-bold text-[#0e1e2a] " +
  "dark:bg-white dark:text-[#0e1e2a]";

// show image-check age without claiming the source image just changed
export const CameraFrameFreshness = ({
  frameStatus,
  now,
  passive = false,
}: CameraFrameFreshnessProps): ReactElement => {
  // initial fetch guard
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

  // failed checks must not look like fresh source images
  if (frameStatus.error || frameStatus.status === "unavailable") {
    return (
      <span
        aria-live={passive ? undefined : "polite"}
        className={className}
        role={passive ? undefined : "status"}
      >
        Image check failed
      </span>
    );
  }

  return (
    <FreshnessPill
      className={className}
      labelPrefix="Image checked"
      now={now}
      passive={passive}
      sourceUpdatedAt={frameStatus.checkedAt}
    />
  );
};
