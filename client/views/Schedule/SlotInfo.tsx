import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode, useEffect, useRef } from "react";
import type { Route } from "shared/contracts/routes";
import type { Slot } from "shared/contracts/schedules";
import type { TerminalLocation } from "shared/contracts/terminals";
import { isNull } from "shared/lib/identity";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { isDuringDaylight } from "~/lib/daylight";
import CalendarIcon from "~/static/images/icons/solid/calendar-alt.svg";
import CarIcon from "~/static/images/icons/solid/car.svg";
import RulerIcon from "~/static/images/icons/solid/ruler-combined.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import UsersIcon from "~/static/images/icons/solid/users.svg";

import { Capacity } from "./Capacity";
import { isCapacityFull } from "./capacityFullness";
import { getGalleyStatus } from "./galleyHours";
import { getCurrentSlot } from "./nowDivider";
import { getProjectedTiming } from "./projectedTiming";
import {
  getLateTextClassName,
  getScheduleRowClassName,
  getScheduleRowState,
  getScheduleSailingContext,
} from "./scheduleColors";
import { isSmallBoatCapacity } from "./smallBoat";
import { Status } from "./Status";
import { Time } from "./Time";
import { formatVesselLength } from "./vesselProfile";
import { VesselStatus } from "./VesselStatus";
import { getForecastLateText, isAfterCurrentSlot } from "./vesselStatus";

const SMALL_BOAT_ROW_LABEL_SAFE_WIDTH = 20;

interface Props {
  className?: string;
  slot: Slot;
  isExpanded: boolean;
  location: TerminalLocation;
  onClick: () => void;
  route?: Route;
  routeMaxVehicleCapacity?: number;
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
    route,
    routeMaxVehicleCapacity,
    schedule,
    setElement,
    slot,
    time,
  } = props;
  const currentSlot = getCurrentSlot(schedule, time);
  const isNext = slot === currentSlot;
  const timing = getProjectedTiming({ schedule, slot });
  const hasDeparted = timing.departureTime.toMillis() < time.toMillis();
  const isDaylight = isDuringDaylight(
    DateTime.fromSeconds(slot.time),
    location
  );
  const sailingContext = getScheduleSailingContext({ isDaylight });
  const liveSpacesLeft = slot.crossing
    ? slot.crossing.driveUpCapacity + slot.crossing.reservableCapacity
    : null;
  const liveCapacityTotal = slot.crossing?.totalCapacity ?? null;
  const livePercentFull =
    liveCapacityTotal && liveSpacesLeft !== null
      ? Math.min(
          ((liveCapacityTotal - liveSpacesLeft) / liveCapacityTotal) * 100,
          100
        )
      : null;
  const vesselVehicleCapacity =
    slot.vessel.vehicleCapacity - slot.vessel.tallVehicleCapacity;
  const estimateSpacesLeft = slot.estimate
    ? slot.estimate.driveUpCapacity + (slot.estimate.reservableCapacity ?? 0)
    : null;
  const estimateCapacityTotal = liveCapacityTotal ?? vesselVehicleCapacity;
  const estimatePercentFull =
    estimateSpacesLeft !== null && estimateCapacityTotal > 0
      ? Math.min(
          ((estimateCapacityTotal - estimateSpacesLeft) /
            estimateCapacityTotal) *
            100,
          100
        )
      : null;
  const isFull = slot.crossing
    ? isCapacityFull({
        percentFull: livePercentFull,
        spacesLeft: liveSpacesLeft,
      })
    : isCapacityFull({
        percentFull: estimatePercentFull,
        spacesLeft: estimateSpacesLeft,
      });
  const timeRowState = getScheduleRowState({
    hasConfirmedCapacity: false,
    isFull,
  });
  // small boat status
  const isSmallBoat = isSmallBoatCapacity(
    slot.vessel.vehicleCapacity,
    routeMaxVehicleCapacity
  );

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
        // align full stripes
        "relative p-3 h-[84.85px]",
        "flex justify-between",
        "cursor-pointer"
      )}
      ref={wrapper}
      onClick={onClick}
      aria-label={`${time.toLocaleString(DateTime.DATETIME_SHORT)} sailing`}
    >
      <Capacity
        hasDeparted={hasDeparted}
        isDaylight={isDaylight}
        leftReservedWidth={isSmallBoat ? SMALL_BOAT_ROW_LABEL_SAFE_WIDTH : 0}
        slot={slot}
      />
      {/* small boat guard */}
      {isSmallBoat && (
        <span
          className={clsx(
            "pointer-events-none absolute -left-px top-1/2 z-10",
            "flex -translate-y-1/2 flex-col items-center justify-center",
            "min-h-[4.5rem] w-5 rounded-r",
            "bg-red-dark text-white dark:bg-red-dark dark:text-white",
            "text-[9px] font-bold leading-none tracking-wide shadow-sm"
          )}
          aria-label="Small boat"
        >
          <ShipIcon className="mb-1 h-3 w-3 shrink-0" />
          <span className="rotate-180 [writing-mode:vertical-rl]">SMALL</span>
        </span>
      )}
      <div className="flex flex-col justify-between items-start z-0">
        <div className="flex-grow" />
        <Status className="" time={time} timing={timing} />
      </div>
      <Time
        context={sailingContext}
        isNext={isNext}
        rowState={timeRowState}
        time={time}
        timing={timing}
      />
    </section>
  );

  // render profile stat
  const renderProfileStat = (
    label: string,
    value: ReactNode,
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  ): ReactNode => (
    <div
      className={clsx(
        "rounded-lg border",
        "border-darken-low dark:border-lighten-low",
        "bg-white/70 dark:bg-black/20",
        "p-3"
      )}
    >
      <div className="mb-1 flex items-center text-2xs uppercase tracking-wide text-gray-dark dark:text-gray-light">
        <Icon className="mr-1.5" />
        {label}
      </div>
      <div className="text-base font-bold leading-tight">{value}</div>
    </div>
  );

  // render details card
  const renderDetails = (): ReactNode => {
    const { vessel } = slot;
    const {
      classId,
      hasElevator,
      hasGalley,
      hasRestroom,
      hasWiFi,
      isAdaAccessible,
      length,
      name,
      passengerCapacity,
      tallVehicleCapacity,
      vehicleCapacity,
      yearBuilt,
    } = vessel;
    const regularVehicleCapacity = vehicleCapacity - tallVehicleCapacity;
    const formattedLength = formatVesselLength(length);
    const galleyStatus = getGalleyStatus({
      route,
      sailingTime: DateTime.fromSeconds(slot.time),
      slot,
    });
    const amenityChips = [
      hasGalley && {
        label:
          galleyStatus === "unknown"
            ? "Galley"
            : `Galley ${galleyStatus.toUpperCase()}`,
        status: galleyStatus,
      },
      hasElevator && { label: "Elevator", status: "unknown" },
      hasRestroom && { label: "Restroom", status: "unknown" },
      hasWiFi && { label: "Wi-Fi", status: "unknown" },
      isAdaAccessible && { label: "ADA", status: "unknown" },
    ].filter(
      (amenity): amenity is { label: string; status: typeof galleyStatus } => {
        // available amenity guard
        return Boolean(amenity);
      }
    );
    // future forecast delay
    const forecastLateText = isAfterCurrentSlot({
      currentSlot,
      schedule,
      slot,
    })
      ? getForecastLateText(timing.delayMins)
      : null;
    // collapsed guard
    if (!isExpanded) {
      return null;
    }
    return (
      <div
        className={clsx(
          "p-3 sm:p-4",
          "text-sm",
          "shadow-inset bg-darken-lowest",
          className
        )}
      >
        <article
          className={clsx(
            "overflow-hidden rounded-xl border",
            "border-gray-medium dark:border-gray-dark",
            "bg-white text-black shadow-sm",
            "dark:bg-gray-darkest dark:text-white"
          )}
        >
          <header
            className={clsx(
              "relative p-4",
              "bg-gradient-to-br from-blue-lightest via-white to-yellow-lightest",
              "dark:from-blue-darkest dark:via-gray-darkest dark:to-yellow-dark"
            )}
          >
            <ShipIcon
              className={clsx(
                "absolute -right-3 -top-4",
                "text-7xl opacity-10"
              )}
            />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {/* small boat guard */}
                  {isSmallBoat && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={clsx(
                          "rounded px-2 py-1",
                          "bg-red-dark text-white dark:bg-red-dark dark:text-white",
                          "whitespace-nowrap text-2xs font-bold uppercase tracking-wide"
                        )}
                      >
                        <ShipIcon className="mr-1 inline-block" />
                        SMALL
                      </span>
                    </div>
                  )}
                  <h3 className="text-2xl font-bold leading-tight">{name}</h3>
                  <p className="mt-1 text-xs text-gray-dark dark:text-gray-light">
                    Class {classId}
                    {formattedLength ? ` · ${formattedLength}` : ""}
                  </p>
                </div>
                {(isNext || forecastLateText) && (
                  <ErrorBoundary
                    className="m-0"
                    fallbackTitle="Vessel status crashed"
                    fallbackMessage="Live vessel status is unavailable for this sailing."
                  >
                    {/* next sailing live status */}
                    {isNext ? (
                      <VesselStatus
                        className="shrink-0 text-right font-medium"
                        delayMins={timing.delayMins}
                        vessel={vessel}
                        time={time}
                      />
                    ) : (
                      <span
                        className={clsx(
                          "shrink-0 text-right text-sm font-bold",
                          getLateTextClassName()
                        )}
                      >
                        {forecastLateText}
                      </span>
                    )}
                  </ErrorBoundary>
                )}
              </div>
              <div className="mt-3 flex w-full flex-wrap gap-2">
                {amenityChips.map(({ label, status }) => {
                  // amenity chip
                  return (
                    <span
                      className={clsx(
                        "rounded-full border px-2 py-1",
                        "text-xs font-semibold shadow-sm",
                        status === "open" &&
                          "border-[#00c853] bg-[#eafff1] text-[#008c3a] dark:border-[#39ff88] dark:bg-[#003f1c] dark:text-[#39ff88]",
                        status === "closed" &&
                          "border-red-dark bg-red-light text-red-dark dark:border-red-light dark:bg-red-dark dark:text-white",
                        status === "unknown" &&
                          "border-gray-medium bg-white text-gray-darkest dark:border-gray-dark dark:bg-black/20 dark:text-white"
                      )}
                      key={label}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          </header>
          <div className="grid grid-cols-2 gap-3 p-4">
            {renderProfileStat(
              "Vehicle deck",
              `${vehicleCapacity} cars`,
              CarIcon
            )}
            {renderProfileStat(
              "Regular / tall",
              `${regularVehicleCapacity} / ${tallVehicleCapacity}`,
              RulerIcon
            )}
            {renderProfileStat(
              "Passengers",
              passengerCapacity.toLocaleString(),
              UsersIcon
            )}
            {renderProfileStat("Build year", yearBuilt, CalendarIcon)}
          </div>
        </article>
      </div>
    );
  };

  const background = getScheduleRowClassName(sailingContext);

  return (
    <li
      className={clsx(
        "border-b",
        "border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.06)]",
        "flex flex-col",
        background
      )}
    >
      {renderHeader()}
      {renderDetails()}
    </li>
  );
};
