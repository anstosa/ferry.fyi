import clsx from "clsx";
import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type { Slot } from "shared/contracts/schedules";
import { getRecordedDelayMins } from "shared/lib/projectedTiming";

import {
  getCapacityUsage,
  isCapacityFull,
} from "~/views/Schedule/capacityFullness";
import {
  getCapacityFillClassName,
  getCapacityOpacityClassName,
} from "~/views/Schedule/capacityStyles";
import { isLateForSummary } from "~/views/Schedule/delayThreshold";
import { getLateTextClassName } from "~/views/Schedule/scheduleColors";

interface Props {
  isDaylight?: boolean;
  slot: Slot;
}

// render facts retained in a compressed sailing row
export const CompactSailingSummary = ({
  isDaylight = true,
  slot,
}: Props): ReactElement => {
  const scheduledTime = DateTime.fromSeconds(slot.time, {
    zone: "America/Los_Angeles",
  });
  const { crossing } = slot;
  const isCancelled =
    Boolean(crossing?.isCancelled) || Boolean(slot.cancellationReason);
  // absent inventory is zero only when reservations are not offered
  const reservableCapacity =
    crossing?.reservableCapacity ??
    (crossing?.hasReservations === false ? 0 : Number.NaN);
  const capacity = getCapacityUsage({
    driveUpCapacity: crossing?.driveUpCapacity,
    reservableCapacity,
    totalCapacity: crossing?.totalCapacity,
  });
  // reject hidden inventory and all-open placeholders without reporting provenance
  const hasConfirmedCapacity =
    !isCancelled &&
    Boolean(crossing?.hasDriveUp) &&
    Number.isFinite(crossing?.driveUpCapacity) &&
    (crossing?.driveUpCapacity ?? -1) >= 0 &&
    Number.isFinite(reservableCapacity) &&
    reservableCapacity >= 0 &&
    capacity.percentFull !== null &&
    capacity.spacesLeft !== null &&
    capacity.spacesLeft < (crossing?.totalCapacity ?? 0);
  const confirmedPercent = capacity.percentFull ?? 0;
  const isFull = isCapacityFull({
    percentFull: capacity.percentFull,
    spacesLeft: capacity.spacesLeft,
  });
  const departureDelta = crossing?.departureDelta;
  // use the full-card minute rounding on this crossing's confirmed report only
  const delayMins =
    typeof departureDelta === "number" && Number.isFinite(departureDelta)
      ? getRecordedDelayMins(slot)
      : null;
  // suppress the on-time window for both early and late compact labels
  const hasConfirmedTiming =
    !isCancelled && delayMins !== null && isLateForSummary(Math.abs(delayMins));
  let sailingStatus: ReactElement | null = null;
  // cancellation precedence
  if (isCancelled) {
    sailingStatus = (
      <span className="relative z-10 shrink-0 font-semibold text-red-700 dark:text-red-200">
        Cancelled
      </span>
    );
  } else if (hasConfirmedTiming) {
    // match full-card late and early colors without using projected timing
    sailingStatus = (
      <span
        className={clsx(
          "relative z-10 shrink-0 font-bold",
          delayMins < 0
            ? "text-yellow-dark dark:text-yellow-medium"
            : getLateTextClassName()
        )}
        title="Confirmed departure timing"
      >
        {Math.abs(delayMins)} min {delayMins < 0 ? "early" : "late"}
      </span>
    );
  }

  return (
    <>
      {/* confirmed capacity background */}
      {hasConfirmedCapacity && (
        <>
          <span
            aria-label={`Confirmed capacity: ${Math.round(
              confirmedPercent
            )}% full`}
            className="sr-only"
          >
            Confirmed capacity: {Math.round(confirmedPercent)}% full
          </span>
          <span
            aria-hidden="true"
            className={clsx(
              "pointer-events-none absolute inset-y-0 left-0 z-0",
              getCapacityFillClassName({ isDaylight, isFull }),
              getCapacityOpacityClassName({ hasDeparted: slot.hasPassed })
            )}
            data-confirmed-capacity-fill=""
            style={{ width: `${confirmedPercent}%` }}
          />
        </>
      )}
      {sailingStatus}
      <span aria-hidden="true" className="relative z-10 flex-1" />
      <time
        aria-label={`Scheduled departure ${scheduledTime.toFormat("h:mm a")}`}
        className="relative z-10 inline-flex shrink-0 items-baseline tabular-nums"
        dateTime={scheduledTime.toISO() ?? undefined}
      >
        <span className="w-[5ch] text-right">
          {scheduledTime.toFormat("h:mm")}
        </span>{" "}
        <span className="ml-1 w-[2ch] text-left">
          {scheduledTime.toFormat("a")}
        </span>
      </time>
    </>
  );
};
