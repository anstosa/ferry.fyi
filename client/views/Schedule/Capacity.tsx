import clsx from "clsx";
import React, { ReactElement, useEffect, useState } from "react";
import type { Slot } from "shared/contracts/schedules";
import { isNil, isNull } from "shared/lib/identity";
import { pluralize } from "shared/lib/strings";

import CarIcon from "~/static/images/icons/solid/car.svg";
import DoNotEnterIcon from "~/static/images/icons/solid/do-not-enter.svg";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link-square.svg";

import { getCapacityDisplayPercent, isCapacityFull } from "./capacityFullness";
import {
  getCapacityFillClassName,
  getCapacityOpacityClassName,
} from "./capacityStyles";

const RESERVATIONS_BASE_URL =
  "https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=";

const LEFT_EDGE = 13;
const RIGHT_EDGE = 85;
const CAPACITY_WIDTH = 125;

interface Props {
  isDaylight: boolean;
  slot: Slot;
}

// schedule capacity bar
export const Capacity = ({ isDaylight, slot }: Props): ReactElement | null => {
  const [percentFull, setPercentFull] = useState<number | null>();
  const [spaceLeft, setSpaceLeft] = useState<number | null>();
  const [estimateFull, setEstimateFull] = useState<number | null>();
  const [estimateLeft, setEstimateLeft] = useState<number | null>();

  const {
    estimate,
    hasPassed,
    vessel: { vehicleCapacity, tallVehicleCapacity },
  } = slot;

  const { crossing } = slot;

  useEffect(() => {
    updateCrossing();
  }, [slot]);

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

  const isLeftEdge = (): boolean => {
    const fullness = getActiveDisplayFullness();
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    return width <= LEFT_EDGE;
  };

  const willFitRight = (): boolean => {
    const fullness = getActiveDisplayFullness();
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    const remainder = totalWidth - width;
    return remainder >= CAPACITY_WIDTH + RIGHT_EDGE;
  };

  const isRightEdge = (): boolean => {
    const fullness = getActiveDisplayFullness();
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    const remainder = totalWidth - width;
    return remainder <= RIGHT_EDGE;
  };

  const isMiddleZone = (): boolean => !isLeftEdge() && !isRightEdge();

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

  const isFull = (): boolean =>
    isCapacityFull({
      percentFull: getActiveCapacityFullness(),
      spacesLeft: getActiveCapacityLeft(),
    });

  const isEstimateFull = (): boolean =>
    isCapacityFull({ percentFull: estimateFull, spacesLeft: estimateLeft });

  const getCapacityDisplayFullness = (): number =>
    getCapacityDisplayPercent({
      isFull: isFull(),
      percentFull: percentFull ?? null,
    });

  const getEstimateDisplayFullness = (): number =>
    getCapacityDisplayPercent({
      isFull: isEstimateFull(),
      percentFull: estimateFull,
    });

  const getActiveDisplayFullness = (): number => {
    // confirmed capacity first
    if (crossing && !isNil(percentFull)) {
      return getCapacityDisplayFullness();
    }

    return getEstimateDisplayFullness();
  };

  const renderSpaceDetail = (): ReactElement | null => {
    let reservationsText = null;
    if (crossing && percentFull) {
      const { departureId } = crossing;
      if (hasAvailableReservations()) {
        reservationsText = (
          <a
            className={clsx(
              "text-xs link",
              "text-dark-green dark:text-green-light"
            )}
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
        <span
          className={clsx(
            "text-xs italic",
            shouldShowLowConfidence
              ? "text-yellow-dark dark:text-yellow-medium"
              : "text-blue-medium dark:text-blue-light"
          )}
        >
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
    if (crossing && percentFull) {
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
        if (!hasPassed) {
          spaceClass = clsx(
            spaceClass,
            "font-bold",
            "text-red-dark dark:text-red-light"
          );
        }
      } else if (percentFull > 80) {
        if (!hasPassed) {
          spaceClass = clsx(
            spaceClass,
            "font-medium",
            "text-yellow-dark dark:text-yellow-medium"
          );
        }
      }
    } else if (estimate && !isNil(estimateLeft)) {
      // forecast spaces
      spaceClass = clsx(spaceClass, "text-gray-dark dark:text-gray-medium");
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
        if (!hasPassed) {
          spaceClass = clsx(
            "text-xs whitespace-nowrap",
            "font-bold",
            "text-red-dark dark:text-red-light"
          );
        }
      }
    } else {
      return null;
    }
    return <span className={spaceClass}>{spaceText}</span>;
  };

  const renderStatus = (): ReactElement | null => {
    if (!crossing && !estimate) {
      return null;
    }
    return (
      <div
        className={clsx(
          "flex flex-col pt-3",
          willFitRight() ? "items-start" : "items-end"
        )}
      >
        {renderSpace()}
        {renderSpaceDetail()}
      </div>
    );
  };

  const showCapacity = Boolean(percentFull);
  const showEstimate = Boolean(
    !hasPassed &&
    !(crossing && isFull()) &&
    !isNil(estimateFull) &&
    estimateFull > (percentFull ?? 0)
  );
  if (!showCapacity && !showEstimate) {
    return null;
  }

  const capacityIsFull = isFull();
  const capacityDisplayFullness = getCapacityDisplayFullness();
  const estimateDisplayFullness = getEstimateDisplayFullness();

  return (
    <>
      {showCapacity && (
        <div
          className={clsx(
            "absolute w-0 top-0 left-0 h-full",
            getCapacityFillClassName({
              isDaylight,
              isFull: capacityIsFull,
            }),
            getCapacityOpacityClassName({ hasPassed })
          )}
          style={{ width: `${capacityDisplayFullness}%` }}
        >
          {isMiddleZone() && (
            <span
              className={clsx(
                "absolute top-0",
                willFitRight() ? "left-full ml-4" : "right-0 mr-4"
              )}
            >
              {renderStatus()}
            </span>
          )}
        </div>
      )}
      {showEstimate && !isNil(estimateFull) && (
        <div
          className={clsx(
            "absolute w-1 top-0 h-full",
            // forecast full threshold
            isEstimateFull()
              ? getCapacityFillClassName({ isDaylight, isFull: true })
              : ["bg-prediction-gradient", "dark:bg-prediction-gradient--dark"],
            "border-darken-lower dark:border-lighten-lower",
            "border-r-4 border-r-dashed"
          )}
          style={{
            left: `${percentFull ?? 0}%`,
            width: `${estimateDisplayFullness - (percentFull ?? 0)}%`,
          }}
        >
          {!showCapacity && isMiddleZone() && (
            <span
              className={clsx(
                "absolute top-0",
                willFitRight() ? "left-full ml-4" : "right-0 mr-4"
              )}
            >
              {renderStatus()}
            </span>
          )}
        </div>
      )}
      {isLeftEdge() && (
        <span className="absolute top-0" style={{ left: LEFT_EDGE }}>
          {renderStatus()}
        </span>
      )}
      {isRightEdge() && (
        <span className="absolute top-0" style={{ right: RIGHT_EDGE }}>
          {renderStatus()}
        </span>
      )}
    </>
  );
};
