import { Capacity } from "./Capacity";
import { DateTime } from "luxon";
import { ErrorBoundary } from "~/lib/ErrorBoundary";
import { find, isNull } from "lodash";
import { isDark } from "~/lib/theme";
import { Status } from "./Status";
import { Time } from "./Time";
import { VesselStatus } from "./VesselStatus";
import { VesselTag } from "~/components/VesselTag";
import clsx from "clsx";
import React, { FC, ReactNode, useEffect, useRef } from "react";
import type { Route } from "shared/models/terminals";
import type { Slot } from "shared/models/schedules";

interface Props {
  slot: Slot;
  isExpanded: boolean;
  onClick: () => void;
  route?: Route;
  schedule: Slot[];
  setElement: (element: HTMLDivElement) => void;
  time: DateTime;
}

export const SlotInfo: FC<Props> = (props) => {
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isNull(wrapper) && !isNull(wrapper.current)) {
      setElement(wrapper.current);
    }
  }, [wrapper]);

  const {
    slot,
    isExpanded,
    onClick,
    route,
    schedule,
    setElement,
    time,
  } = props;

  const { hasPassed } = slot;
  const isNext = slot === find(schedule, { hasPassed: false });

  const renderHeader = (): ReactNode => (
    <div
      className={clsx(
        "relative p-3 h-20",
        "flex justify-between",
        "cursor-pointer"
      )}
      ref={wrapper}
      onClick={onClick}
    >
      <Capacity slot={slot} />
      <div className="flex flex-col justify-between items-start z-0">
        <div className="flex-grow" />
        <Status className="" slot={slot} time={time} />
      </div>
      <Time slot={slot} time={time} isNext={isNext} />
    </div>
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
        className={clsx("p-4 flex", "text-sm", "shadow-inset bg-darken-lowest")}
      >
        <div
          className={clsx(
            "flex-grow pr-4",
            "border-r border-dashed border-gray-medium"
          )}
        >
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
        {route && (
          <div className={clsx("flex-grow", "pl-4")}>
            Crossing: {route.crossingTime}mins
          </div>
        )}
      </div>
    );
  };

  let background: string;
  if (hasPassed) {
    background = isDark ? "bg-gray-darkest" : "bg-gray-light";
  } else if (isNext) {
    background = isDark ? "bg-blue-darkest" : "bg-blue-lightest";
  } else {
    background = isDark ? "bg-black" : "bg-white";
  }

  return (
    <li
      className={clsx(
        "border-b",
        isDark ? "border-gray-dark" : "border-gray-medium",
        "flex flex-col",
        background
      )}
    >
      {renderHeader()}
      {renderDetails()}
    </li>
  );
};
