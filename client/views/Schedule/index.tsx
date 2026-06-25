import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useState } from "react";
import scrollIntoView from "scroll-into-view";
import type {
  Schedule as ScheduleClass,
  Slot,
} from "shared/contracts/schedules";
import { isEmpty } from "shared/lib/arrays";
import { values } from "shared/lib/objects";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { InlineLoader } from "~/components/InlineLoader";
import { Toast } from "~/components/Toast";
import { isWSFToday } from "~/lib/date";
import { useTerminals } from "~/lib/terminals";
import IslandIcon from "~/static/images/icons/solid/island-tropical.svg";

import { NowDivider } from "./NowDivider";
import { getCurrentSlot, shouldRenderNowDivider } from "./nowDivider";
import { SlotInfo } from "./SlotInfo";
import {
  getCurrentRouteMaxVehicleCapacity,
  getRouteMaxVehicleCapacity,
} from "./smallBoat";

interface Props {
  schedule: ScheduleClass | null;
  time: DateTime;
}

export const Schedule = ({ schedule, time }: Props): ReactElement => {
  const { terminals } = useTerminals();
  const [currentElement, setCurrentElement] = useState<HTMLDivElement | null>(
    null
  );
  const [capacityWarningDismissed, setCapacityWarningDismissed] =
    useState<boolean>(false);
  const [expanded, setExpanded] = useState<Slot | null>(null);

  // update schedule on parameter change
  // useEffect(() => {
  //   setCurrentElement(null);
  // }, [schedule]);

  useEffect(() => {
    if (currentElement) {
      scrollIntoView(currentElement, { align: { top: 0.3 } });
    }
  }, [currentElement, schedule]);

  const toggleExpand = (slot: Slot): void => {
    if (slot === expanded) {
      setExpanded(null);
    } else {
      setExpanded(slot);
    }
  };

  const renderSchedule = (): ReactElement | null => {
    // schedule loading guard
    if (!schedule?.slots) {
      return <InlineLoader>Loading schedule...</InlineLoader>;
    }
    const { slots } = schedule;
    if (isEmpty(slots)) {
      return (
        <div
          className={clsx(
            "absolute inset-0",
            "bg-white text-gray-500 dark:bg-black",
            "flex justify-center items-center"
          )}
        >
          No sailings scheduled
          <IslandIcon className="text-2xl ml-4" />
        </div>
      );
    }
    const currentSlot = getCurrentSlot(schedule.slots, time);
    const currentRouteMaxVehicleCapacity = getCurrentRouteMaxVehicleCapacity(
      slots.map(({ vessel }) => {
        // collect scheduled capacity
        return vessel.vehicleCapacity;
      })
    );
    let hasCapacityInfo = false;
    // build sailing rows
    const sailings = slots.map((slot) => {
      const { time: slotTime, crossing } = slot;
      if (crossing) {
        hasCapacityInfo = true;
      }
      const terminal = terminals.find(({ id }) => {
        // selected terminal match
        return id === schedule.terminalId;
      });
      if (!terminal) {
        return null;
      }
      const route = values(terminal.routes)?.find(({ terminalIds }) => {
        // selected route match
        return (
          terminalIds.includes(schedule.terminalId) &&
          terminalIds.includes(schedule.mateId)
        );
      });
      const routeMaxVehicleCapacity = getRouteMaxVehicleCapacity(
        currentRouteMaxVehicleCapacity,
        route?.normalVehicleMaxCapacity
      );
      const showNowDivider = shouldRenderNowDivider({
        schedule: slots,
        slot,
        time,
      });
      return (
        <React.Fragment key={slotTime}>
          {/* current-time boundary */}
          {showNowDivider && <NowDivider />}
          <ErrorBoundary
            className="m-2"
            fallbackTitle="Sailing crashed"
            fallbackMessage="This sailing could not be shown, but the rest of the schedule is still available."
            resetKey={slotTime}
          >
            <SlotInfo
              slot={slot}
              isExpanded={slotTime === expanded?.time}
              location={terminal.location}
              onClick={() => toggleExpand(slot)}
              schedule={slots}
              route={route}
              routeMaxVehicleCapacity={routeMaxVehicleCapacity}
              setElement={(element: HTMLDivElement) => {
                // current slot anchor
                if (slot === currentSlot) {
                  setCurrentElement(element);
                }
              }}
              time={time}
            />
          </ErrorBoundary>
        </React.Fragment>
      );
    });
    return (
      <>
        <ul>{sailings}</ul>
        <AnimatePresence>
          {!hasCapacityInfo &&
            isWSFToday(DateTime.fromISO(schedule.date)) &&
            !capacityWarningDismissed && (
              <Toast warning onClose={() => setCapacityWarningDismissed(true)}>
                WSF capacity info currently unavailable. Pay attention to
                cameras and forecasts to estimate load!
              </Toast>
            )}
        </AnimatePresence>
      </>
    );
  };

  return (
    <>
      <main
        className={clsx(
          "overflow-y-auto",
          "w-full max-h-full",
          "relative",
          "flex-grow flex-shrink",
          "flex flex-col items-center",
          "pr-safe-right pl-safe-left",
          "bg-white text-black dark:bg-black dark:text-white"
        )}
        id="main"
      >
        <div
          className={clsx(
            "w-full max-w-6xl bg-white dark:bg-black",
            "lg:border-l lg:border-r",
            "border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]"
          )}
        >
          {renderSchedule()}
        </div>
      </main>
    </>
  );
};
