import { isDark } from "~/lib/theme";
import { isNil, isNull } from "~/lib/identity";
import CarIcon from "~/images/icons/solid/car.svg";
import clsx from "clsx";
import DoNotEnterIcon from "~/images/icons/solid/do-not-enter.svg";
import ExternalLinkIcon from "~/images/icons/solid/external-link-square.svg";
import React, { FC, ReactNode, useEffect, useState } from "react";
import type { Crossing, Slot } from "shared/models/schedules";

const RESERVATIONS_BASE_URL =
  "https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=";

const LEFT_EDGE = 13;
const RIGHT_EDGE = 85;
const CAPACITY_WIDTH = 125;

interface Props {
  slot: Slot;
}

export const Capacity: FC<Props> = (props) => {
  const { slot } = props;
  const [percentFull, setPercentFull] = useState<number | null>();
  const [spaceLeft, setSpaceLeft] = useState<number | null>();
  const [estimateFull, setEstimateFull] = useState<number | null>();
  const [estimateLeft, setEstimateLeft] = useState<number | null>();

  const {
    estimate,
    hasPassed,
    vessel: { vehicleCapacity, tallVehicleCapacity },
  } = slot;

  const crossing = slot.crossing as Crossing;

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
    ) as number;
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
    const fullness =
      crossing && percentFull ? percentFull ?? 0 : estimateFull ?? 0;
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    return width <= LEFT_EDGE;
  };

  const willFitRight = (): boolean => {
    const fullness =
      crossing && percentFull ? percentFull ?? 0 : estimateFull ?? 0;
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    const remainder = totalWidth - width;
    return remainder >= CAPACITY_WIDTH + RIGHT_EDGE;
  };

  const isRightEdge = (): boolean => {
    const fullness =
      crossing && percentFull ? percentFull ?? 0 : estimateFull ?? 0;
    const percent = fullness / 100;
    const totalWidth = window.innerWidth;
    const width = percent * totalWidth;
    const remainder = totalWidth - width;
    return remainder <= RIGHT_EDGE;
  };

  const isMiddleZone = (): boolean => !isLeftEdge() && !isRightEdge();

  const isFull = (): boolean => {
    const spaces = crossing && percentFull ? spaceLeft : estimateLeft;
    return !isNil(spaces) && spaces <= 0;
  };

  const renderSpaceDetail = (): ReactNode => {
    let reservationsText = null;
    if (crossing && percentFull) {
      const { departureId } = crossing;
      if (hasAvailableReservations()) {
        reservationsText = (
          <a
            className={clsx(
              "text-xs link",
              isDark ? "text-green-light" : "text-green-dark"
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
            className={clsx(
              "text-xs",
              isDark ? "text-gray-light" : "text-gray-dark"
            )}
          >
            Standby Only
          </span>
        );
      }
    } else if (estimate) {
      reservationsText = (
        <span
          className={clsx(
            "text-xs italic",
            isDark ? "text-blue-medium" : "text-blue-light"
          )}
        >
          Forecast
        </span>
      );
    }
    return reservationsText;
  };

  const renderSpace = (): ReactNode => {
    let spaceText;
    let spaceClass = clsx("text-xs whitespace-nowrap");
    if (crossing && percentFull) {
      spaceText = (
        <>
          <CarIcon className="inline-block mr-1" />
          {spaceLeft} spaces left
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
            isDark ? "text-red-light" : "text-red-dark"
          );
        }
      } else if (percentFull > 80) {
        if (!hasPassed) {
          spaceClass = clsx(
            spaceClass,
            "font-medium",
            isDark ? "text-yellow-light" : "text-yellow-dark"
          );
        }
      }
    } else if (estimate && !isNil(estimateLeft)) {
      spaceClass = clsx(spaceClass, "text-gray-medium");
      spaceText = (
        <>{estimateLeft > 0 ? `${estimateLeft} spaces left` : "Boat full"}</>
      );
    } else {
      return null;
    }
    return <span className={spaceClass}>{spaceText}</span>;
  };

  const renderStatus = (): ReactNode => {
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
    !hasPassed && !isNil(estimateFull) && estimateFull > (percentFull ?? 0)
  );
  if (!showCapacity && !showEstimate) {
    return null;
  }

  return (
    <>
      {showCapacity && (
        <div
          className={clsx(
            "absolute w-0 top-0 left-0 h-full",
            // eslint-disable-next-line no-nested-ternary
            hasPassed
              ? isDark
                ? "bg-lighten-lower"
                : "bg-darken-lower"
              : isDark
              ? "bg-blue-dark"
              : "bg-blue-light"
          )}
          style={{ width: `${percentFull}%` }}
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
            `bg-prediction-gradient${isDark && "--dark"}`,
            isDark ? "border-lighten-lower" : "border-darken-lower",
            "border-r-4 border-r-dashed"
          )}
          style={{
            left: `${percentFull ?? 0}%`,
            width: `${estimateFull - (percentFull ?? 0)}%`,
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
