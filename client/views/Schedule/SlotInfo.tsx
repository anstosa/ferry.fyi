import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode, useEffect, useRef } from "react";
import type { Route } from "shared/contracts/routes";
import type { Slot } from "shared/contracts/schedules";
import type { TerminalLocation } from "shared/contracts/terminals";
import { isNull } from "shared/lib/identity";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { isDuringDaylight } from "~/lib/daylight";
import { vesselAssets } from "~/lib/generated/vesselAssets";
import {
  isLocalhostSimulationEnabled,
  setSimulatedVessel,
} from "~/lib/onboardSimulation";
import { useTrackedVessel } from "~/lib/onboardTracking";
import CarIcon from "~/static/images/icons/solid/car.svg";
import CheckCircleIcon from "~/static/images/icons/solid/check-circle.svg";
import ExclamationCircleIcon from "~/static/images/icons/solid/exclamation-circle.svg";
import RulerIcon from "~/static/images/icons/solid/ruler-combined.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import UsersIcon from "~/static/images/icons/solid/users.svg";

import { Capacity } from "./Capacity";
import { isCapacityFull } from "./capacityFullness";
import { getGalleyStatus } from "./galleyHours";
import { getCurrentSlot } from "./nowDivider";
import { getProjectedTiming } from "./projectedTiming";
import {
  getScheduleRowClassName,
  getScheduleRowState,
  getScheduleSailingContext,
} from "./scheduleColors";
import { isSmallBoatCapacity } from "./smallBoat";
import { Status } from "./Status";
import { getTidalCancellationRisk } from "./tidalCancellationRisk";
import { Time } from "./Time";
import { getVesselProfileStats } from "./vesselProfile";
import { VesselStatus } from "./VesselStatus";
import { getDelayCardModel } from "./vesselStatus";

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
  terminalId: string;
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
    terminalId,
    time,
  } = props;
  const [, setTrackedVesselId] = useTrackedVessel();
  const currentSlot = getCurrentSlot(schedule, time);
  const isNext = slot === currentSlot;
  const timing = getProjectedTiming({ schedule, slot });
  const tidalCancellationRisk = getTidalCancellationRisk({
    departureTerminalId: terminalId,
    slot,
  });
  const isConfirmedCancelled = timing.isCancelled;
  const hasTidalCancellationRisk = Boolean(tidalCancellationRisk);
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
  const vesselVehicleCapacity = Math.max(
    0,
    (slot.vessel.vehicleCapacity ?? 0) - (slot.vessel.tallVehicleCapacity ?? 0)
  );
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

  // render cancellation frame
  const renderCancellationFrame = (): ReactNode => {
    // normal sailing guard
    if (!isConfirmedCancelled && !hasTidalCancellationRisk) {
      return null;
    }
    const isPastCancelled = isConfirmedCancelled && slot.hasPassed;
    return (
      <div
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute inset-1 z-20 rounded-xl",
          "border-4 border-dotted",
          isConfirmedCancelled
            ? "border-red-dark dark:border-red-light"
            : "border-late-light dark:border-late-dark",
          isPastCancelled && "opacity-30"
        )}
      >
        {/* cancelled stamp */}
        {isConfirmedCancelled && (
          <span
            className={clsx(
              "absolute left-1/2 top-1/2",
              "-translate-x-1/2 -translate-y-1/2 -rotate-6",
              "text-4xl font-black uppercase tracking-[0.25em]",
              "text-red-dark opacity-30 dark:text-red-light",
              "sm:text-5xl"
            )}
          >
            CANCELLED
          </span>
        )}
      </div>
    );
  };

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
        "relative isolate p-3 h-[84.85px]",
        "flex justify-between",
        "cursor-pointer"
      )}
      ref={wrapper}
      onClick={onClick}
      aria-label={`${time.toLocaleString(DateTime.DATETIME_SHORT)} sailing`}
    >
      {/* cancellation frame */}
      {renderCancellationFrame()}
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

  // render delay card
  const renderDelayCard = (
    delayCard: ReturnType<typeof getDelayCardModel>
  ): ReactNode => {
    const isOrange = delayCard.isLate;
    const StatusIcon = isOrange ? ExclamationCircleIcon : CheckCircleIcon;
    return (
      <section
        className={clsx(
          "col-span-2 rounded-lg border p-3",
          isOrange
            ? [
                "border-late-light bg-[#fff3e8] text-late-light",
                "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
              ]
            : [
                "border-blue-medium bg-blue-lightest text-blue-dark",
                "dark:border-blue-light dark:bg-blue-dark/30 dark:text-blue-light",
              ]
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-bold leading-tight">
            <StatusIcon className="h-5 w-5 shrink-0" />
            <span>{delayCard.title}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {delayCard.signals.map(({ label, value }) => {
              // delay signal row
              return (
                <div
                  className="rounded bg-white/70 p-2 text-gray-darkest dark:bg-black/20 dark:text-white"
                  key={label}
                >
                  <dt className="font-semibold uppercase tracking-wide text-gray-dark dark:text-gray-light">
                    {label}
                  </dt>
                  <dd
                    className={clsx(
                      "mt-1 font-bold",
                      value === "Unavailable" &&
                        "text-gray-medium dark:text-gray-medium"
                    )}
                  >
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>
    );
  };

  // render tidal risk card
  const renderTidalRiskCard = (): ReactNode => {
    // risk availability guard
    if (!tidalCancellationRisk) {
      return null;
    }
    return (
      <section
        className={clsx(
          "col-span-2 rounded-lg border p-3",
          "border-late-light bg-[#fff3e8] text-late-light",
          "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark"
        )}
      >
        <div className="flex items-start gap-2">
          <ExclamationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="text-base font-bold leading-tight">
              {tidalCancellationRisk.title}
            </div>
            <p className="mt-2 text-xs leading-snug text-gray-darkest dark:text-white">
              {tidalCancellationRisk.explanation}
            </p>
          </div>
        </div>
      </section>
    );
  };

  // render details card
  const renderDetails = (): ReactNode => {
    const { vessel } = slot;
    const { classId, hasGalley, hasWiFi, name } = vessel;
    const vesselAsset = vesselAssets[vessel.id];
    const {
      passengerCapacityLabel,
      regularVehicleCapacity,
      tallVehicleCapacity,
      vehicleCapacity,
      vesselClassLabel,
    } = getVesselProfileStats(vessel, vesselAsset?.className ?? classId);
    const delayCard = getDelayCardModel({
      delayMins: timing.delayMins,
      slot,
    });
    const galleyStatus = getGalleyStatus({
      currentTime: time,
      route,
      sailingTime: DateTime.fromSeconds(slot.time),
      schedule,
      slot,
    });
    const galleyChipStatus =
      hasGalley && galleyStatus === "open" ? "open" : "closed";
    const galleyChipLabel = hasGalley
      ? `Galley ${galleyChipStatus.toUpperCase()}`
      : "NO Galley";
    const amenityChips: Array<{
      label: string;
      status: typeof galleyStatus;
    }> = [
      {
        label: galleyChipLabel,
        status: galleyChipStatus,
      },
      {
        label: hasWiFi ? "Wi-Fi ON" : "Wi-Fi OFF",
        status: hasWiFi ? "open" : "closed",
      },
    ];
    const canTrackBoat = Boolean(
      isNext &&
      vessel.gpsDelay &&
      vessel.arrivingTerminalId &&
      vessel.departingTerminalId
    );
    // track boat action
    const trackBoat = (event: React.MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setTrackedVesselId(vessel.id);
    };
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
              "relative overflow-hidden p-4",
              "bg-gradient-to-br from-blue-lightest via-white to-yellow-lightest",
              "dark:from-blue-darkest dark:via-gray-darkest dark:to-yellow-dark"
            )}
          >
            {/* vessel image guard */}
            {vesselAsset && (
              <img
                alt=""
                className={clsx(
                  "pointer-events-none absolute bottom-0 right-0 max-w-none translate-x-1/2",
                  "max-h-[110%] w-full select-none object-contain object-left-bottom"
                )}
                src={vesselAsset.image}
              />
            )}
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="max-w-[70%]">
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
                  <h3
                    className="text-2xl font-bold leading-tight"
                    onClick={(event) => {
                      // ctrl-click guard
                      if (!event.ctrlKey) {
                        return;
                      }
                      // localhost simulation guard
                      if (!isLocalhostSimulationEnabled()) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      setSimulatedVessel(vessel.id);
                    }}
                  >
                    {name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ErrorBoundary
                      className="m-0"
                      fallbackTitle="Vessel status crashed"
                      fallbackMessage="Live vessel status is unavailable for this sailing."
                    >
                      {/* live vessel status */}
                      <VesselStatus
                        className="block items-start text-left font-medium text-gray-dark dark:text-gray-light"
                        vessel={vessel}
                        time={time}
                      />
                    </ErrorBoundary>
                    {/* track boat guard */}
                    {canTrackBoat && (
                      <button
                        className="link text-sm font-bold text-blue-dark dark:text-blue-light"
                        type="button"
                        onClick={trackBoat}
                      >
                        Track Boat
                      </button>
                    )}
                  </div>
                </div>
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
            {/* tidal risk card */}
            {renderTidalRiskCard()}
            {/* timing card */}
            {!isConfirmedCancelled && renderDelayCard(delayCard)}
            {renderProfileStat(
              "Vehicle deck",
              `${vehicleCapacity} cars`,
              CarIcon
            )}
            {renderProfileStat(
              "Cars / Trucks",
              `${regularVehicleCapacity} / ${tallVehicleCapacity}`,
              RulerIcon
            )}
            {renderProfileStat("Passengers", passengerCapacityLabel, UsersIcon)}
            {renderProfileStat("Class", vesselClassLabel, ShipIcon)}
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
        "relative",
        background
      )}
    >
      {renderHeader()}
      {renderDetails()}
    </li>
  );
};
