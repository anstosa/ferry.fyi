import clsx from "clsx";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import type { Slot } from "shared/contracts/schedules";
import { isNil, isNull } from "shared/lib/identity";
import { pluralize } from "shared/lib/strings";

import CarIcon from "~/static/images/icons/solid/car.svg";
import DoNotEnterIcon from "~/static/images/icons/solid/do-not-enter.svg";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link.svg";

import { shouldUseForecastCapacityStatus } from "./capacityDisplaySource";
import { getCapacityDisplayPercent, isCapacityFull } from "./capacityFullness";
import { getCapacityStatusSide } from "./capacityStatusPosition";
import {
  getCapacityFillClassName,
  getCapacityOpacityClassName,
  getForecastCapacityFillClassName,
} from "./capacityStyles";
import { isForecastExpectedFull } from "./forecastRiskPresentation";
import {
  getScheduleLiveSpaceState,
  getScheduleSailingContext,
  getScheduleSpaceClassName,
  type ScheduleRowState,
} from "./scheduleColors";

const RESERVATIONS_BASE_URL =
  "https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=";

const ROW_PADDING = 12;
const STATUS_MARGIN = 16;
const STATUS_WIDTH = 125;
const TIME_WIDTH = 64;

interface Props {
  hasDeparted: boolean;
  isDaylight: boolean;
  leftReservedWidth?: number;
  slot: Slot;
}

// schedule capacity bar
export const Capacity = ({
  hasDeparted,
  isDaylight,
  leftReservedWidth = 0,
  slot,
}: Props): ReactElement | null => {
  const [percentFull, setPercentFull] = useState<number | null>();
  const [spaceLeft, setSpaceLeft] = useState<number | null>();
  const [estimateFull, setEstimateFull] = useState<number | null>();
  const [estimateLeft, setEstimateLeft] = useState<number | null>();
  const [rowWidth, setRowWidth] = useState<number>(0);
  const rowRef = useRef<HTMLDivElement>(null);

  const {
    estimate,
    vessel: { vehicleCapacity, tallVehicleCapacity },
  } = slot;

  const { crossing } = slot;
  const isCancelled = crossing?.isCancelled === true;
  const sailingContext = getScheduleSailingContext({ isDaylight });

  useEffect(() => {
    updateCrossing();
  }, [slot]);

  useEffect(() => {
    const updateRowWidth = (): void => {
      // mounted row guard
      if (!rowRef.current) {
        return;
      }
      setRowWidth(rowRef.current.getBoundingClientRect().width);
    };
    updateRowWidth();
    const resizeObserver = new ResizeObserver(updateRowWidth);
    // mounted observer guard
    if (rowRef.current) {
      resizeObserver.observe(rowRef.current);
    }
    window.addEventListener("resize", updateRowWidth);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateRowWidth);
    };
  }, [estimateFull, percentFull]);

  const getEstimateLeft = (): number | null => {
    if (!estimate || isNil(estimate.driveUpCapacity)) {
      return null;
    }
    const { driveUpCapacity = 0, reservableCapacity = 0 } = estimate;
    const estimateLeft = driveUpCapacity + (reservableCapacity ?? 0);
    return estimateLeft;
  };

  const getEstimateFull = (): number | null => {
    const estimateLeft = getEstimateLeft();
    if (isNull(estimateLeft)) {
      return null;
    }
    const totalCapacity = crossing?.totalCapacity ?? getVesselCapacity();
    const estimateFull = Math.min(
      ((totalCapacity - estimateLeft) / totalCapacity) * 100,
      100
    );
    return estimateFull;
  };

  const getVesselCapacity = (): number => vehicleCapacity - tallVehicleCapacity;

  const updateCrossing = (): void => {
    let spaceLeft: number | undefined;
    let percentFull: number | undefined;

    if (crossing) {
      const {
        driveUpCapacity = 0,
        reservableCapacity = 0,
        totalCapacity,
      } = crossing;

      spaceLeft = driveUpCapacity + reservableCapacity;
      percentFull = Math.min(
        ((totalCapacity - spaceLeft) / totalCapacity) * 100,
        100
      );
    }

    setEstimateLeft(getEstimateLeft());
    setEstimateFull(getEstimateFull());
    setSpaceLeft(spaceLeft);
    setPercentFull(percentFull);
  };

  const hasAvailableReservations = (): boolean =>
    (crossing?.reservableCapacity ?? 0) > 0;

  const allowsReservations = (): boolean => crossing?.hasReservations ?? false;

  const getActiveCapacityFullness = (): number | null => {
    // confirmed capacity first
    if (crossing && !isNil(percentFull)) {
      return percentFull;
    }

    return estimateFull ?? null;
  };

  const getActiveCapacityLeft = (): number | null => {
    // confirmed capacity first
    if (crossing && !isNil(percentFull)) {
      return spaceLeft ?? null;
    }

    return estimateLeft ?? null;
  };

  const isEstimateFull = (): boolean =>
    isForecastExpectedFull(estimate?.fullRisk);

  const isFull = (): boolean => {
    // forecast-only full state
    if (!crossing) {
      return isEstimateFull();
    }
    return isCapacityFull({
      percentFull: getActiveCapacityFullness(),
      spacesLeft: getActiveCapacityLeft(),
    });
  };

  const getCapacityDisplayFullness = (): number => {
    // cancelled sailing guard
    if (isCancelled) {
      return 0;
    }
    return getCapacityDisplayPercent({
      isFull: isFull(),
      percentFull: percentFull ?? null,
    });
  };

  const getEstimateDisplayFullness = (): number => {
    // cancelled sailing guard
    if (isCancelled) {
      return 0;
    }
    return getCapacityDisplayPercent({
      isFull: isEstimateFull(),
      percentFull: estimateFull,
    });
  };

  const hasLiveCapacity = (): boolean =>
    Boolean(crossing && !isNil(percentFull));

  // forecast capacity availability
  const hasForecastCapacity = (): boolean =>
    Boolean(estimate && !isNil(estimateLeft));

  // live empty report check
  const isLiveCapacityEmpty = (): boolean =>
    hasLiveCapacity() && spaceLeft === crossing?.totalCapacity;

  // forecast status choice
  const shouldUseForecastStatus = (): boolean =>
    shouldUseForecastCapacityStatus({
      hasDeparted,
      hasForecastCapacity: hasForecastCapacity(),
      hasLiveCapacity: hasLiveCapacity(),
      isLiveCapacityEmpty: isLiveCapacityEmpty(),
    });

  // forecast extension visibility
  const showEstimate = Boolean(
    !isCancelled &&
    !hasDeparted &&
    !(crossing && isFull()) &&
    !isNil(estimateFull) &&
    estimateFull > (percentFull ?? 0)
  );

  const getLiveCrossing = (): typeof crossing | null => {
    // live crossing guard
    if (!hasLiveCapacity()) {
      return null;
    }
    return crossing ?? null;
  };

  const getStatusLinePercent = (): number => {
    // forecast status source
    if (shouldUseForecastStatus()) {
      return getEstimateDisplayFullness();
    }
    // live capacity line first
    if (hasLiveCapacity()) {
      return getCapacityDisplayFullness();
    }
    return getEstimateDisplayFullness();
  };

  const getMeasuredRowWidth = (): number => rowWidth || window.innerWidth;

  const getStatusLineX = (): number =>
    (getStatusLinePercent() / 100) * getMeasuredRowWidth();

  const getTimeColumnLeft = (): number =>
    getMeasuredRowWidth() - ROW_PADDING - TIME_WIDTH;

  const getStatusSide = (): "left" | "right" =>
    getCapacityStatusSide({
      linePercent: getStatusLinePercent(),
      margin: STATUS_MARGIN,
      leftReservedWidth,
      rowPadding: ROW_PADDING,
      rowWidth: getMeasuredRowWidth(),
      statusWidth: STATUS_WIDTH,
      timeWidth: TIME_WIDTH,
    });

  const getLeftStatusOffset = (): number => {
    const anchorX = Math.min(getStatusLineX(), getTimeColumnLeft());
    // left badge clearance
    const safeAnchorX = Math.max(
      anchorX,
      leftReservedWidth + STATUS_MARGIN * 2 + STATUS_WIDTH
    );
    return Math.max(0, getMeasuredRowWidth() - safeAnchorX + STATUS_MARGIN);
  };

  const getRightStatusOffset = (): number => {
    // left badge clearance
    return Math.max(getStatusLineX(), leftReservedWidth) + STATUS_MARGIN;
  };

  const getPositionedStatusStyle = (): React.CSSProperties => {
    const side = getStatusSide();
    // right-side label
    if (side === "right") {
      return { left: getRightStatusOffset() };
    }
    return {
      left: leftReservedWidth + STATUS_MARGIN,
      right: getLeftStatusOffset(),
    };
  };

  const renderPositionedStatus = (): ReactElement | null => {
    const status = renderStatus();
    // empty status guard
    if (!status) {
      return null;
    }
    return (
      <span className="absolute top-0" style={getPositionedStatusStyle()}>
        {status}
      </span>
    );
  };

  const renderSpaceDetail = (): ReactElement | null => {
    let reservationsText = null;
    const liveCrossing = getLiveCrossing();
    const detailClassName = getScheduleSpaceClassName(sailingContext, "normal");
    if (shouldUseForecastStatus() && estimate) {
      // low confidence only
      const shouldShowLowConfidence = estimate.confidence === "low";
      reservationsText = (
        <span className={clsx("text-xs italic", detailClassName)}>
          {/* forecast label */}
          {!shouldShowLowConfidence && <span className="block">Forecast</span>}
          {/* low confidence only */}
          {shouldShowLowConfidence && (
            <span className="block whitespace-nowrap">Low confidence</span>
          )}
        </span>
      );
    } else if (liveCrossing) {
      const { departureId } = liveCrossing;
      if (hasAvailableReservations()) {
        reservationsText = (
          <a
            className={clsx("text-xs link", detailClassName)}
            href={RESERVATIONS_BASE_URL + departureId}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLinkIcon className="inline-block mr-1" />
            Reserve
          </a>
        );
      } else if (allowsReservations()) {
        reservationsText = (
          <span
            className={clsx("text-xs", "text-gray-dark dark:text-gray-light")}
          >
            Standby Only
          </span>
        );
      }
    } else if (estimate) {
      // low confidence only
      const shouldShowLowConfidence = estimate.confidence === "low";
      reservationsText = (
        <span className={clsx("text-xs italic", detailClassName)}>
          {/* forecast label */}
          {!shouldShowLowConfidence && <span className="block">Forecast</span>}
          {/* low confidence only */}
          {shouldShowLowConfidence && (
            <span className="block whitespace-nowrap">Low confidence</span>
          )}
        </span>
      );
    }
    return reservationsText;
  };

  const renderSpace = (): ReactElement | null => {
    let spaceText;
    let spaceClass = clsx("text-xs whitespace-nowrap");
    if (shouldUseForecastStatus() && !isNil(estimateLeft)) {
      // forecast spaces
      const state: ScheduleRowState = isEstimateFull() ? "full" : "normal";
      spaceClass = clsx(
        spaceClass,
        getScheduleSpaceClassName(sailingContext, state)
      );
      spaceText = (
        <>
          <CarIcon className="inline-block mr-1" />
          {pluralize(estimateLeft, "space")} left
        </>
      );
      // forecast full threshold
      if (isEstimateFull()) {
        spaceText = (
          <>
            <DoNotEnterIcon className="inline-block mr-1" />
            Boat full
          </>
        );
        // future warning
        if (!hasDeparted) {
          spaceClass = clsx(
            "text-xs whitespace-nowrap",
            "font-bold",
            getScheduleSpaceClassName(sailingContext, "full")
          );
        }
      }
    } else if (hasLiveCapacity()) {
      const state = getScheduleLiveSpaceState({
        hasForecastExtension: showEstimate,
        isFull: isFull(),
        statusSide: getStatusSide(),
      });
      spaceClass = clsx(
        spaceClass,
        getScheduleSpaceClassName(sailingContext, state)
      );
      spaceText = (
        <>
          <CarIcon className="inline-block mr-1" />
          {pluralize(spaceLeft ?? 0, "space")} left
        </>
      );
      if (isFull()) {
        spaceText = (
          <>
            <DoNotEnterIcon className="inline-block mr-1" />
            Boat full
          </>
        );
        if (!hasDeparted) {
          spaceClass = clsx(
            spaceClass,
            "font-bold",
            getScheduleSpaceClassName(sailingContext, "full")
          );
        }
      } else if ((percentFull ?? 0) > 80) {
        if (!hasDeparted) {
          spaceClass = clsx(spaceClass, "font-medium");
        }
      }
    } else if (estimate && !isNil(estimateLeft)) {
      // forecast spaces
      const state: ScheduleRowState = isFull() ? "full" : "normal";
      spaceClass = clsx(
        spaceClass,
        getScheduleSpaceClassName(sailingContext, state)
      );
      spaceText = (
        <>
          <CarIcon className="inline-block mr-1" />
          {pluralize(estimateLeft, "space")} left
        </>
      );
      // forecast full threshold
      if (isFull()) {
        spaceText = (
          <>
            <DoNotEnterIcon className="inline-block mr-1" />
            Boat full
          </>
        );
        // future warning
        if (!hasDeparted) {
          spaceClass = clsx(
            "text-xs whitespace-nowrap",
            "font-bold",
            getScheduleSpaceClassName(sailingContext, "full")
          );
        }
      }
    } else {
      return null;
    }
    return <span className={spaceClass}>{spaceText}</span>;
  };

  const renderStatus = (): ReactElement | null => {
    // cancelled sailing guard
    if (isCancelled) {
      return null;
    }
    if (!crossing && !estimate) {
      return null;
    }
    return (
      <div
        className={clsx(
          "flex flex-col pt-3",
          getStatusSide() === "right" ? "items-start" : "items-end"
        )}
      >
        {renderSpace()}
        {renderSpaceDetail()}
      </div>
    );
  };

  const showCapacity = hasLiveCapacity() || isCancelled;
  if (!showCapacity && !showEstimate) {
    return null;
  }

  const capacityIsFull = !isCancelled && isFull();
  const capacityDisplayFullness = getCapacityDisplayFullness();
  const estimateDisplayFullness = getEstimateDisplayFullness();
  const estimateReachesRowEnd = estimateDisplayFullness >= 100;

  return (
    <div className="absolute inset-0 overflow-hidden" ref={rowRef}>
      {showCapacity && (
        <div
          className={clsx(
            "absolute w-0 top-0 left-0 h-full",
            getCapacityFillClassName({
              isDaylight,
              isFull: capacityIsFull,
            }),
            getCapacityOpacityClassName({ hasDeparted })
          )}
          style={{ width: `${capacityDisplayFullness}%` }}
        />
      )}
      {showEstimate && !isNil(estimateFull) && (
        <div
          className={clsx(
            "absolute w-1 top-0 h-full",
            // forecast fill
            getForecastCapacityFillClassName({ isFull: isEstimateFull() }),
            // interior forecast edge only
            !estimateReachesRowEnd && [
              "border-darken-lower dark:border-lighten-lower",
              "border-r-4 border-r-dashed",
            ]
          )}
          style={{
            left: `${percentFull ?? 0}%`,
            width: `${estimateDisplayFullness - (percentFull ?? 0)}%`,
          }}
        />
      )}
      {renderPositionedStatus()}
    </div>
  );
};
