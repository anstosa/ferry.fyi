import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode, useEffect, useRef } from "react";
import type { Route } from "shared/contracts/routes";
import type { Slot } from "shared/contracts/schedules";
import type { TerminalLocation } from "shared/contracts/terminals";
import { findWhere } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { VesselTag } from "~/components/VesselTag";
import { isDuringDaylight } from "~/lib/daylight";

import { Capacity } from "./Capacity";
import { Status } from "./Status";
import { Time } from "./Time";
import { VesselStatus } from "./VesselStatus";

interface Props {
  className?: string;
  slot: Slot;
  isExpanded: boolean;
  location: TerminalLocation;
  onClick: () => void;
  route?: Route;
  schedule: Slot[];
  setElement: (element: HTMLDivElement) => void;
  time: DateTime;
}

export const SlotInfo = (props: Props): ReactElement => {
  const {
    className = "",
    isExpanded,
    location,
    onClick,
    schedule,
    setElement,
    slot,
    time,
  } = props;
  const isNext =
    time.toISODate !== DateTime.local().toISODate &&
    slot === findWhere(schedule, { hasPassed: false });

  const wrapper = useRef<HTMLDivElement>(null);

  // expose row element
  useEffect(() => {
    // mounted ref guard
    if (!isNull(wrapper.current)) {
      setElement(wrapper.current);
    }
  }, [wrapper]);

  const renderHeader = (): ReactNode => (
    <section
      className={clsx(
        "relative p-3 h-20",
        "flex justify-between",
        "cursor-pointer"
      )}
      ref={wrapper}
      onClick={onClick}
      aria-label={`${time.toLocaleString(DateTime.DATETIME_SHORT)} sailing`}
    >
      <Capacity isDaylight={isDaylight} slot={slot} />
      <div className="flex flex-col justify-between items-start z-0">
        <div className="flex-grow" />
        <Status className="" slot={slot} time={time} />
      </div>
      <Time slot={slot} time={time} isNext={isNext} />
    </section>
  );

  const renderDetails = (): ReactNode => {
    const { vessel } = slot;
    const { vehicleCapacity, tallVehicleCapacity } = vessel;
    const capacity = vehicleCapacity - tallVehicleCapacity;
    if (!isExpanded) {
      return null;
    }
    return (
      <div
        className={clsx(
          "p-4 flex",
          "text-sm",
          "shadow-inset bg-darken-lowest",
          className
        )}
      >
        <div className={clsx("flex-grow pr-4")}>
          <div className="flex items-center mb-2">
            <VesselTag vessel={vessel} />
            <ErrorBoundary
              className="m-0"
              fallbackTitle="Vessel status crashed"
              fallbackMessage="Live vessel status is unavailable for this sailing."
            >
              <VesselStatus
                className="flex-glow ml-2"
                vessel={vessel}
                time={time}
              />
            </ErrorBoundary>
          </div>
          <span className="text-xs">Capacity: {capacity}</span>
        </div>
      </div>
    );
  };

  const isDaylight = isDuringDaylight(
    DateTime.fromSeconds(slot.time),
    location
  );
  const background = isDaylight
    ? "bg-yellow-lightest text-black dark:bg-yellow-dark dark:text-white"
    : "bg-blue-lightest text-black dark:bg-blue-darkest dark:text-white";

  return (
    <li
      className={clsx(
        "border-b",
        "border-gray-medium dark:border-gray-dark",
        "flex flex-col",
        background
      )}
    >
      {renderHeader()}
      {renderDetails()}
    </li>
  );
};
