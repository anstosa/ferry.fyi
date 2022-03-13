import { Capacity } from "./Capacity";
import { DateTime } from "luxon";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { findWhere } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import { Route } from "shared/contracts/routes";
import { Status } from "./Status";
import { Time } from "./Time";
import { VesselStatus } from "./VesselStatus";
import { VesselTag } from "~/components/VesselTag";
import clsx from "clsx";
import React, { ReactElement, ReactNode, useEffect, useRef } from "react";
import type { Slot } from "shared/contracts/schedules";

interface Props {
  className?: string;
  slot: Slot;
  isExpanded: boolean;
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
    onClick,
    schedule,
    setElement,
    slot,
    time,
  } = props;
  const { hasPassed } = slot;
  const isNext =
    time.toISODate !== DateTime.local().toISODate &&
    slot === findWhere(schedule, { hasPassed: false });

  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      <Capacity slot={slot} />
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
            <ErrorBoundary>
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

  let background: string;
  if (hasPassed) {
    background = "bg-gray-light dark:bg-gray-darkest";
  } else if (isNext) {
    background = "bg-blue-lightest dark:bg-blue-darkest";
  } else {
    background = "bg-white dark:bg-black";
  }

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
