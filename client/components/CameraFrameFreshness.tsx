import React, { type ReactElement, useEffect, useState } from "react";
import type { CameraFrameStatus } from "shared/contracts/cameraFrames";
import { formatUpdatedAt } from "shared/lib/freshness";

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
  if (passive) {
    return <PassiveCameraFrameFreshness frameStatus={frameStatus} now={now} />;
  }

  // Initial fetch guard
  if (!frameStatus) {
    return (
      <span aria-live="polite" className={className} role="status">
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
        sourceUpdatedAt={frameStatus.checkedAt}
        verb="Checked"
      />
    );
  }

  return (
    <FreshnessPill
      className={className}
      now={now}
      sourceUpdatedAt={sourceUpdatedAt}
    />
  );
};

const PassiveCameraFrameFreshness = ({
  frameStatus,
  now: fixedNow,
}: Omit<CameraFrameFreshnessProps, "passive">): ReactElement => {
  const [currentNow, setCurrentNow] = useState(() => Date.now() / 1000);
  const now = fixedNow ?? currentNow;

  useEffect(() => {
    if (fixedNow !== undefined) {
      return undefined;
    }

    const updateClock = (): void => setCurrentNow(Date.now() / 1000);
    const delay = 60_000 - (Date.now() % 60_000);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      updateClock();
      interval = window.setInterval(updateClock, 60_000);
    }, delay);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [fixedNow]);

  if (!frameStatus) {
    return <span className={className}>Checking image…</span>;
  }

  const sourceUpdatedAt = frameStatus.frameUpdatedAt;
  const hasSourceUpdatedAt = Number.isFinite(sourceUpdatedAt);
  const label = formatUpdatedAt(
    hasSourceUpdatedAt ? sourceUpdatedAt : frameStatus.checkedAt,
    now,
    hasSourceUpdatedAt ? undefined : "Checked"
  );

  return <span className={className}>{label}</span>;
};
